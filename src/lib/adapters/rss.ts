/**
 * RSS / Atom.
 *
 * WHY A FEED ADAPTER IS IN A SOCIAL ANALYTICS PRODUCT:
 *
 * Most of the platforms this tool measures have closed their public APIs. X
 * charges four figures a month for what used to be free, Instagram and Facebook
 * only return data for pages you own, TikTok's research API is
 * application-gated, and LinkedIn has no competitor read path at all. For a
 * newsroom benchmarking itself against a dozen rivals, that means large parts of
 * the landscape are simply unmeasurable through social APIs.
 *
 * Their RSS feeds, however, are still wide open — because publishers need them
 * for syndication. A feed will never tell you how a story performed, but it
 * tells you two things that matter a great deal and are otherwise unavailable:
 *
 *   1. **Publishing cadence** — how much a competitor is putting out, in which
 *      sections, at what hours, and whether that changed this month.
 *   2. **What they are pointing at** — every posted URL, which flows into
 *      `posted_urls` and powers the "what are they driving traffic to" view.
 *
 * So every engagement number here is a hard zero, and that is correct rather
 * than missing data: a feed item has no likes because a feed has no audience.
 * The metrics layer must exclude `rss` channels from engagement leaderboards
 * entirely — showing a publisher at 0.0% engagement rate next to their Bluesky
 * account would be actively misleading. `audience` is likewise empty; there is
 * no follower count for a feed.
 *
 * The parser below is regex-based on purpose. Next.js server bundles have no
 * DOM, and pulling in a real XML parser would add a dependency (and a parser
 * CVE surface) to read a document format we only need five fields out of. It
 * handles RSS 2.0, RSS 1.0/RDF and Atom 1.0, which is everything a publisher
 * CMS actually emits.
 */
import type { Platform } from '@/lib/types';
import {
  AdapterError,
  type AdapterProfile,
  type ChannelAdapter,
  type FetchContext,
  type FetchResult,
  type NormalizedPost,
} from './types';
import { fetchRaw } from './util/request';
import { classifyPostType, extractHashtags, extractMentions, extractUrls } from './util/normalize';

const PLATFORM: Platform = 'rss';

/** Feeds are occasionally enormous; refuse to parse a 50MB "feed". */
const MAX_FEED_BYTES = 8 * 1024 * 1024;

/* --------------------------------------------------------- XML plumbing */

const NAMED_ENTITIES: Record<string, string> = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ',
  ldquo: '“', rdquo: '”', lsquo: '‘', rsquo: '’',
  mdash: '—', ndash: '–', hellip: '…', trade: '™',
  copy: '©', reg: '®', deg: '°', eacute: 'é', egrave: 'è',
};

/**
 * Entity decoding is done twice in some feeds: WordPress escapes `&amp;amp;` in
 * titles routinely. One extra pass is applied only when the first pass produced
 * another entity, so legitimate text containing "&amp;" is not mangled.
 */
export function decodeEntities(input: string): string {
  const once = (s: string): string => s.replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (match, body: string) => {
    if (body.startsWith('#')) {
      const isHex = body[1] === 'x' || body[1] === 'X';
      const code = Number.parseInt(isHex ? body.slice(2) : body.slice(1), isHex ? 16 : 10);
      if (!Number.isFinite(code) || code <= 0 || code > 0x10ffff) return match;
      try { return String.fromCodePoint(code); } catch { return match; }
    }
    return NAMED_ENTITIES[body.toLowerCase()] ?? match;
  });
  const first = once(input);
  return /&(#x?[0-9a-f]+|[a-z]+);/i.test(first) ? once(first) : first;
}

/** `<![CDATA[ ... ]]>` unwrapping, including feeds that emit several sections. */
function stripCdata(input: string): string {
  return input.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1');
}

/** Turn markup into readable plain text, preserving paragraph breaks. */
export function stripTags(input: string): string {
  return input
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, '')
    .replace(/<\/(p|div|li|h[1-6])>/gi, '\n')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]*>/g, '')
    .replace(/[ \t ]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/**
 * All elements with the given local name, namespace prefix ignored, returned as
 * their inner XML. Self-closing elements yield an empty string so callers can
 * still read their attributes from `findAttrs`.
 */
function findBlocks(xml: string, localName: string): string[] {
  const re = new RegExp(`<(?:[A-Za-z0-9_.-]+:)?${localName}(\\s[^>]*)?(/)?>`, 'gi');
  const closeRe = new RegExp(`</(?:[A-Za-z0-9_.-]+:)?${localName}\\s*>`, 'i');
  const out: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml)) !== null) {
    if (m[2]) { out.push(''); continue; }
    const rest = xml.slice(re.lastIndex);
    const close = closeRe.exec(rest);
    if (!close) continue;
    out.push(rest.slice(0, close.index));
    re.lastIndex += close.index + close[0].length;
  }
  return out;
}

/** Decoded text of the first matching element, trying each name in order. */
function findText(xml: string, ...localNames: string[]): string | undefined {
  for (const name of localNames) {
    const blocks = findBlocks(xml, name);
    for (const block of blocks) {
      const value = decodeEntities(stripCdata(block)).trim();
      if (value) return value;
    }
  }
  return undefined;
}

/** Attribute maps for every occurrence of an element (needed for `<link>`). */
function findAttrs(xml: string, localName: string): Record<string, string>[] {
  const re = new RegExp(`<(?:[A-Za-z0-9_.-]+:)?${localName}(\\s[^>]*?)?/?>`, 'gi');
  const out: Record<string, string>[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml)) !== null) {
    const attrs: Record<string, string> = {};
    const source = m[1] ?? '';
    const attrRe = /([A-Za-z_:][-A-Za-z0-9_:.]*)\s*=\s*"([^"]*)"|([A-Za-z_:][-A-Za-z0-9_:.]*)\s*=\s*'([^']*)'/g;
    let a: RegExpExecArray | null;
    while ((a = attrRe.exec(source)) !== null) {
      const key = (a[1] ?? a[3]).toLowerCase();
      attrs[key] = decodeEntities(a[2] ?? a[4] ?? '');
    }
    out.push(attrs);
  }
  return out;
}

/**
 * Dates in feeds are RFC 822 (`Tue, 28 Jul 2026 09:00:00 -0400`), RFC 3339, or
 * whatever the CMS felt like. `Date.parse` handles the first two; anything else
 * is rejected rather than silently becoming 1970, which would drop the item
 * outside every reporting window forever.
 */
function parseFeedDate(value: string | undefined): Date | undefined {
  if (!value) return undefined;
  const t = Date.parse(value.trim());
  if (Number.isNaN(t)) return undefined;
  const d = new Date(t);
  const year = d.getUTCFullYear();
  return year > 1990 && year < 2200 ? d : undefined;
}

/* ------------------------------------------------------------- parsing */

export interface FeedMeta {
  title?: string;
  siteUrl?: string;
  description?: string;
  imageUrl?: string;
  language?: string;
}

export interface FeedEntry {
  id: string;
  title?: string;
  link?: string;
  summary?: string;
  content?: string;
  publishedAt?: Date;
  categories: string[];
  author?: string;
  enclosureUrl?: string;
  enclosureType?: string;
  imageUrl?: string;
}

export interface ParsedFeed {
  meta: FeedMeta;
  entries: FeedEntry[];
}

/**
 * Atom `<link>` is an element with attributes, not text; RSS `<link>` is text.
 * Both appear, sometimes in the same document, so both are tried and
 * `rel="alternate"` (or a bare `rel`) wins over `rel="self"`, which points at
 * the feed itself rather than the article.
 */
function resolveLink(block: string): string | undefined {
  const textual = findText(block, 'link');
  if (textual && /^https?:\/\//i.test(textual)) return textual;

  const links = findAttrs(block, 'link').filter((a) => a.href);
  const alternate = links.find((a) => !a.rel || a.rel === 'alternate');
  const chosen = alternate ?? links.find((a) => a.rel !== 'self');
  return chosen?.href;
}

function collectCategories(block: string): string[] {
  const textual = findBlocks(block, 'category')
    .map((b) => decodeEntities(stripCdata(b)).trim())
    .filter(Boolean);
  // Atom puts the value in `term`; RSS puts it in the element body.
  const termed = findAttrs(block, 'category').map((a) => a.term).filter((t): t is string => Boolean(t));
  return Array.from(new Set([...textual, ...termed].map((c) => c.trim()).filter(Boolean)));
}

/** Split the feed into item/entry blocks without parsing the whole document. */
function splitEntries(xml: string): string[] {
  const items = findBlocks(xml, 'item');
  if (items.length > 0) return items;
  return findBlocks(xml, 'entry');
}

export function parseFeed(xml: string): ParsedFeed {
  const trimmed = xml.replace(/^﻿/, '').trim();
  if (!/<(?:[A-Za-z0-9_.-]+:)?(rss|feed|rdf:RDF|RDF)\b/i.test(trimmed)) {
    throw new AdapterError(
      'That URL did not return an RSS or Atom feed. Check that it is the feed URL and not the page it appears on.',
      { platform: PLATFORM, retryable: false },
    );
  }

  const entryBlocks = splitEntries(trimmed);

  // Channel-level metadata must be read from the document *minus* the entries,
  // or the first article's <title> is mistaken for the publication's title.
  let head = trimmed;
  for (const block of entryBlocks) {
    const at = head.indexOf(block);
    if (at >= 0) head = head.slice(0, at) + head.slice(at + block.length);
  }

  const meta: FeedMeta = {
    title: findText(head, 'title'),
    siteUrl: resolveLink(head),
    description: findText(head, 'description', 'subtitle', 'tagline'),
    imageUrl: findAttrs(head, 'image')[0]?.href ?? findText(head, 'url') ?? findText(head, 'logo', 'icon'),
    language: findText(head, 'language') ?? findAttrs(head, 'feed')[0]?.['xml:lang'],
  };

  const entries: FeedEntry[] = [];
  for (const block of entryBlocks) {
    const link = resolveLink(block);
    // guid/id is the canonical identity; the link is the fallback, and the
    // title is a last resort for feeds that supply neither (they exist).
    const guid = findText(block, 'guid', 'id') ?? link ?? findText(block, 'title');
    if (!guid) continue;

    const enclosure = findAttrs(block, 'enclosure')[0] ?? findAttrs(block, 'content')[0];
    const mediaContent = findAttrs(block, 'content').find((a) => a.url) ?? findAttrs(block, 'thumbnail')[0];

    entries.push({
      id: guid,
      title: findText(block, 'title'),
      link,
      summary: findText(block, 'description', 'summary'),
      content: findText(block, 'encoded', 'content'),
      publishedAt: parseFeedDate(findText(block, 'pubDate', 'published', 'date', 'updated', 'issued')),
      categories: collectCategories(block),
      author: findText(block, 'creator', 'author', 'name'),
      enclosureUrl: enclosure?.url,
      enclosureType: enclosure?.type,
      imageUrl: mediaContent?.url ?? mediaContent?.href,
    });
  }

  return { meta, entries };
}

/* ------------------------------------------------------------ adapter */

function normalizeFeedUrl(input: string): string {
  const trimmed = input.trim();
  const withScheme = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
  let url: URL;
  try {
    url = new URL(withScheme);
  } catch {
    throw new AdapterError(`Not a valid feed URL: ${input}`, { platform: PLATFORM, retryable: false });
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new AdapterError(`Feed URLs must be http or https: ${input}`, { platform: PLATFORM, retryable: false });
  }
  if (!url.hostname.includes('.')) {
    throw new AdapterError(`Feed URL has no host: ${input}`, { platform: PLATFORM, retryable: false });
  }
  // The fragment is never sent to the server and only creates duplicate
  // channel rows for the same feed.
  url.hash = '';
  return url.toString();
}

interface FetchedFeed {
  parsed: ParsedFeed;
  etag?: string;
  lastModified?: string;
  notModified: boolean;
}

async function loadFeed(
  feedUrl: string,
  cursor: Record<string, unknown>,
  ctx?: Pick<FetchContext, 'onApiCall' | 'signal'>,
): Promise<FetchedFeed> {
  // Conditional GET. Publishers watch their feed bandwidth, and a tool that
  // polls a hundred newsroom feeds hourly without honouring ETags is the kind
  // of tool that gets its user agent blocked.
  const headers: Record<string, string> = {
    accept: 'application/rss+xml, application/atom+xml, application/xml;q=0.9, text/xml;q=0.9, */*;q=0.5',
    'user-agent': 'Data Dumpster/1.0 (+competitive analytics; feed reader)',
  };
  const etag = typeof cursor.etag === 'string' ? cursor.etag : undefined;
  const lastModified = typeof cursor.lastModified === 'string' ? cursor.lastModified : undefined;
  if (etag) headers['if-none-match'] = etag;
  if (lastModified) headers['if-modified-since'] = lastModified;

  const response = await fetchRaw(feedUrl, {
    platform: PLATFORM,
    headers,
    onApiCall: ctx?.onApiCall,
    signal: ctx?.signal,
  });

  if (response.status === 304) {
    return { parsed: { meta: {}, entries: [] }, etag, lastModified, notModified: true };
  }
  if (response.text.length > MAX_FEED_BYTES) {
    throw new AdapterError(
      `Feed is larger than ${Math.round(MAX_FEED_BYTES / 1024 / 1024)}MB; refusing to parse.`,
      { platform: PLATFORM, retryable: false },
    );
  }

  return {
    parsed: parseFeed(response.text),
    etag: response.headers.get('etag') ?? undefined,
    lastModified: response.headers.get('last-modified') ?? undefined,
    notModified: false,
  };
}

function entryToPost(entry: FeedEntry, feedUrl: string, siteUrl?: string): NormalizedPost | undefined {
  if (!entry.publishedAt) return undefined;

  const title = entry.title?.trim() ?? '';
  const bodyHtml = entry.content ?? entry.summary ?? '';
  const body = stripTags(bodyHtml);
  // Same convention as the YouTube adapter: headline first, then body, so
  // keyword rules written against "text" behave identically across platforms.
  const text = [title, body].filter(Boolean).join('\n\n');

  const isAudioVideo = /^(audio|video)\//i.test(entry.enclosureType ?? '');
  const isImage = /^image\//i.test(entry.enclosureType ?? '');

  // Links inside the article body are the interesting ones for "what are they
  // pointing at", but the item's own link comes first because it is the thing
  // being published.
  const urls = Array.from(new Set([
    ...(entry.link ? [entry.link] : []),
    ...extractUrls(bodyHtml),
  ]));

  return {
    externalId: entry.id,
    postedAt: entry.publishedAt,
    type: classifyPostType({
      platform: PLATFORM,
      hasVideo: isAudioVideo && /^video\//i.test(entry.enclosureType ?? ''),
      hasImage: isImage,
      // A feed item is an article unless it is carrying a media enclosure —
      // which is how podcasts and video feeds present themselves.
      isArticle: !isAudioVideo,
    }),
    text: text || null,
    permalink: entry.link ?? null,
    mediaUrl: entry.enclosureUrl ?? null,
    thumbnailUrl: entry.imageUrl ?? null,
    // Podcast feeds carry <itunes:duration>, but it is variously seconds or
    // HH:MM:SS and is not worth guessing at; left null rather than wrong.
    durationSec: null,
    language: null,
    // Feed <category> values are the publisher's own section/tag taxonomy,
    // which is exactly what hashtags are used for elsewhere in the product.
    hashtags: Array.from(new Set([
      ...entry.categories.map((c) => c.toLowerCase().replace(/\s+/g, '-')),
      ...extractHashtags(text),
    ])),
    mentions: extractMentions(text),
    urls,
    // Every engagement number is zero by definition — see the file header.
    applause: 0,
    conversation: 0,
    amplification: 0,
    saves: 0,
    views: 0,
    raw: {
      feedUrl,
      siteUrl: siteUrl ?? null,
      author: entry.author ?? null,
      categories: entry.categories,
      enclosureType: entry.enclosureType ?? null,
      hasFullContent: Boolean(entry.content),
    },
  };
}

export const rssAdapter: ChannelAdapter = {
  platform: PLATFORM,
  displayName: 'RSS / Atom',
  accessNotes:
    'No credentials required — point it at any RSS 2.0 or Atom feed URL. This tracks publishing cadence '
    + 'and the URLs a publisher is pushing, which is the only competitive signal still available for '
    + 'platforms whose APIs are closed. Feeds carry no engagement or audience data, so every engagement '
    + 'metric on an RSS channel is zero by definition and these channels are excluded from engagement '
    + 'leaderboards. Conditional GET (ETag / If-Modified-Since) is used so repeated polling is cheap for '
    + 'the publisher.',
  credentialFields: [],
  // Self-imposed politeness limit rather than a published quota: roughly one
  // poll every 30 seconds per feed is far more than any newsroom needs.
  rateLimit: { callsPerWindow: 120, windowSeconds: 3_600 },
  worksUnauthenticated: true,

  parseHandle(input: string): string {
    return normalizeFeedUrl(input);
  },

  async resolveProfile(handle: string): Promise<AdapterProfile> {
    const feedUrl = normalizeFeedUrl(handle);
    const { parsed } = await loadFeed(feedUrl, {});
    const host = new URL(feedUrl).hostname.replace(/^www\./, '');

    return {
      externalId: feedUrl,
      // The feed URL is the identity, but the host is what a human recognises
      // in a channel list.
      handle: host,
      displayName: parsed.meta.title ?? host,
      avatarUrl: parsed.meta.imageUrl ?? null,
      profileUrl: parsed.meta.siteUrl ?? `https://${host}`,
      // A feed has no followers. Reporting 0 would put this publisher at the
      // bottom of an audience leaderboard as though they had no readers.
      followers: undefined,
      meta: {
        feedUrl,
        description: parsed.meta.description ?? null,
        language: parsed.meta.language ?? null,
        entryCount: parsed.entries.length,
      },
    };
  },

  async fetch(ctx: FetchContext): Promise<FetchResult> {
    const feedUrl = normalizeFeedUrl(ctx.externalId ?? ctx.handle);
    const feed = await loadFeed(feedUrl, ctx.cursor, ctx);

    if (feed.notModified) {
      return {
        posts: [],
        audience: [],
        cursor: { ...ctx.cursor, lastRunAt: new Date().toISOString() },
        hasMore: false,
      };
    }

    const warnings: string[] = [];
    const posts: NormalizedPost[] = [];
    const seen = new Set<string>();
    let undated = 0;

    for (const entry of feed.parsed.entries) {
      const post = entryToPost(entry, feedUrl, feed.parsed.meta.siteUrl);
      if (!post) { undated++; continue; }
      if (post.postedAt < ctx.since || post.postedAt > ctx.until) continue;
      if (seen.has(post.externalId)) continue;
      seen.add(post.externalId);
      posts.push(post);
      if (posts.length >= ctx.limit) break;
    }

    if (undated > 0) {
      warnings.push(`${undated} feed item(s) had no usable publish date and were skipped.`);
    }
    // A feed is a *window* on recent output, not an archive. If everything in
    // it is newer than `since`, older items have already scrolled off and this
    // channel needs a shorter polling interval, not another page.
    const oldest = posts.reduce<Date | undefined>(
      (acc, p) => (!acc || p.postedAt < acc ? p.postedAt : acc), undefined,
    );
    if (oldest && feed.parsed.entries.length > 0 && oldest > ctx.since && posts.length === feed.parsed.entries.length) {
      warnings.push('Every item in the feed is newer than the requested window; older posts have scrolled off. Poll this feed more often.');
    }

    return {
      posts,
      // Feeds have no audience. An empty array is the honest answer; a row of
      // zeroes would show up as a publisher losing all their followers.
      audience: [],
      profile: {
        externalId: feedUrl,
        handle: new URL(feedUrl).hostname.replace(/^www\./, ''),
        displayName: feed.parsed.meta.title,
        avatarUrl: feed.parsed.meta.imageUrl ?? null,
        profileUrl: feed.parsed.meta.siteUrl ?? null,
        meta: { feedUrl, language: feed.parsed.meta.language ?? null },
      },
      cursor: {
        feedUrl,
        etag: feed.etag ?? null,
        lastModified: feed.lastModified ?? null,
        lastRunAt: new Date().toISOString(),
      },
      hasMore: false,
      warnings: warnings.length > 0 ? warnings : undefined,
    };
  },

  async healthCheck(): Promise<{ ok: boolean; message: string }> {
    return { ok: true, message: 'No credentials required. Feed reachability is checked when a channel is added.' };
  },
};

export default rssAdapter;
