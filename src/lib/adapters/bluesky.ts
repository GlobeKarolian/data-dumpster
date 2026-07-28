/**
 * Bluesky — AT Protocol, via the public XRPC appview.
 *
 * This is the only adapter in the product that needs no credentials at all.
 * `public.api.bsky.app` serves the same read endpoints as an authenticated
 * appview for public accounts, which means a newsroom can add every competitor's
 * Bluesky presence without a single API application, review process, or key
 * rotation. That is a genuine structural advantage of the protocol and worth
 * exploiting: this adapter should always be the first one an org turns on.
 *
 * What the protocol does and does not give us:
 *
 *  - `likeCount` → applause, `replyCount` → conversation, and
 *    `repostCount + quoteCount` → amplification. Bluesky is the only platform
 *    here that separates plain reposts from quote posts; they are summed because
 *    both are "someone put this in front of their own audience", which is what
 *    amplification means everywhere else in the product.
 *  - **There are no view counts and no bookmarks.** The appview does not expose
 *    impressions to anyone, not even the author. `views` and `saves` are
 *    therefore always 0, and engagement-rate-by-view is undefined on Bluesky.
 *  - **`record.createdAt` is client-supplied** and can be anything the posting
 *    client felt like writing, including dates in the future. `indexedAt` is
 *    server-stamped and trustworthy. We prefer `createdAt` (it is what users
 *    see) but clamp it to `indexedAt` when it is implausible, otherwise one
 *    misconfigured client can park a post at the top of a chart forever.
 *  - **Facets carry the real links.** Display text is truncated
 *    ("nytimes.com/2026/…") while the facet holds the full URI, so link
 *    extraction reads facets first and only falls back to regex on the text.
 */
import type { Platform } from '@/lib/types';
import {
  AdapterError,
  type AdapterProfile,
  type ChannelAdapter,
  type FetchContext,
  type FetchResult,
  type NormalizedAudience,
  type NormalizedPost,
} from './types';
import { asArray, asCount, asDate, asRecord, asString, fetchJson } from './util/request';
import { classifyPostType, extractHashtags, extractMentions, extractUrls, toDayString } from './util/normalize';

const PLATFORM: Platform = 'bluesky';
const XRPC = 'https://public.api.bsky.app/xrpc';

/** `getAuthorFeed` caps `limit` at 100. */
const FEED_PAGE_SIZE = 100;
/** Hard stop on pagination so a very prolific account cannot run forever. */
const MAX_FEED_PAGES = 25;
/** How far `record.createdAt` may lead `indexedAt` before we stop believing it. */
const CREATED_AT_TOLERANCE_MS = 5 * 60 * 1000;

const DID_RE = /^did:(plc|web):[a-z0-9._:%-]+$/i;

function xrpc<T>(method: string, params: Record<string, string | number | undefined>, ctx?: Pick<FetchContext, 'onApiCall' | 'signal'>): Promise<T> {
  return fetchJson<T>(`${XRPC}/${method}`, {
    platform: PLATFORM,
    query: params,
    onApiCall: ctx?.onApiCall,
    signal: ctx?.signal,
    // XRPC returns `{error, message}`; the useful part is the error name for
    // things like `AccountTakedown` and `InvalidRequest`, both of which are
    // permanent and must not be retried.
    extractMessage: (parsed) => {
      const rec = asRecord(parsed);
      const name = asString(rec?.error);
      const detail = asString(rec?.message);
      if (name && detail) return `${name}: ${detail}`;
      return name ?? detail;
    },
    classifyRetryable: ({ status, parsed }) => {
      if (status !== 400) return undefined;
      const name = asString(asRecord(parsed)?.error);
      // A 400 here is almost always a bad actor/cursor, which retrying will not fix.
      return name === 'UpstreamFailure' || name === 'NotEnoughResources' ? true : false;
    },
  });
}

/** `at://did:plc:xyz/app.bsky.feed.post/3kabc` → `3kabc`. */
function rkeyFromUri(uri: string): string | undefined {
  const parts = uri.split('/');
  const last = parts[parts.length - 1];
  return last && last !== '' ? last : undefined;
}

/**
 * Rich-text facets are byte-indexed into the UTF-8 encoding of the post text,
 * but we only need the feature payloads, not the offsets, so no byte-slicing is
 * required — which is fortunate, because JS string indices are UTF-16.
 */
interface FacetHarvest {
  tags: string[];
  mentions: string[];
  urls: string[];
}

function harvestFacets(facets: unknown[]): FacetHarvest {
  const tags: string[] = [];
  const mentions: string[] = [];
  const urls: string[] = [];

  for (const raw of facets) {
    const features = asArray(asRecord(raw)?.features);
    for (const f of features) {
      const feature = asRecord(f);
      const type = asString(feature?.$type);
      if (!feature || !type) continue;
      if (type.includes('#tag')) {
        const tag = asString(feature.tag);
        if (tag) tags.push(tag.replace(/^#/, '').toLowerCase());
      } else if (type.includes('#link')) {
        const uri = asString(feature.uri);
        if (uri) urls.push(uri);
      } else if (type.includes('#mention')) {
        // The facet stores the DID, which is stable but unreadable. The handle
        // is recovered from the text by `extractMentions`; the DID is kept in
        // `raw` for anyone who needs to follow a renamed account.
        const did = asString(feature.did);
        if (did) mentions.push(did);
      }
    }
  }
  return { tags, mentions, urls };
}

/** Map an embed union to our shared post vocabulary. */
function typeFromEmbed(embed: Record<string, unknown> | undefined, text: string): NormalizedPost['type'] {
  const type = asString(embed?.$type) ?? '';
  const images = asArray(embed?.images);

  if (type.includes('app.bsky.embed.video')) {
    return classifyPostType({ platform: PLATFORM, hasVideo: true });
  }
  if (type.includes('app.bsky.embed.images')) {
    return classifyPostType({ platform: PLATFORM, hasImage: true, mediaCount: images.length });
  }
  if (type.includes('recordWithMedia')) {
    const media = asRecord(embed?.media);
    return typeFromEmbed(media, text);
  }
  if (type.includes('app.bsky.embed.record')) {
    // A quote post: the author added their own commentary, so it is their post,
    // not a repost. Typed by whatever the commentary itself contains.
    return classifyPostType({ platform: PLATFORM, hasLink: extractUrls(text).length > 0 });
  }
  if (type.includes('app.bsky.embed.external')) {
    return classifyPostType({ platform: PLATFORM, hasLink: true });
  }
  return classifyPostType({ platform: PLATFORM, hasLink: extractUrls(text).length > 0 });
}

function mediaFromEmbed(embed: Record<string, unknown> | undefined): { mediaUrl: string | null; thumbnailUrl: string | null } {
  if (!embed) return { mediaUrl: null, thumbnailUrl: null };
  const type = asString(embed.$type) ?? '';

  if (type.includes('recordWithMedia')) return mediaFromEmbed(asRecord(embed.media));

  const firstImage = asRecord(asArray(embed.images)[0]);
  if (firstImage) {
    return {
      mediaUrl: asString(firstImage.fullsize) ?? null,
      thumbnailUrl: asString(firstImage.thumb) ?? null,
    };
  }
  if (type.includes('video')) {
    return { mediaUrl: asString(embed.playlist) ?? null, thumbnailUrl: asString(embed.thumbnail) ?? null };
  }
  const external = asRecord(embed.external);
  if (external) {
    return { mediaUrl: asString(external.uri) ?? null, thumbnailUrl: asString(external.thumb) ?? null };
  }
  return { mediaUrl: null, thumbnailUrl: null };
}

function readProfile(body: unknown, fallbackHandle: string): { profile: AdapterProfile; audience: NormalizedAudience } {
  const rec = asRecord(body);
  const did = asString(rec?.did);
  if (!rec || !did) {
    throw new AdapterError(`No Bluesky profile found for "${fallbackHandle}"`, { platform: PLATFORM, retryable: false });
  }
  const handle = asString(rec.handle) ?? fallbackHandle;
  const followers = asCount(rec.followersCount);

  return {
    profile: {
      externalId: did,
      handle,
      displayName: asString(rec.displayName),
      avatarUrl: asString(rec.avatar) ?? null,
      profileUrl: `https://bsky.app/profile/${handle}`,
      followers,
      meta: {
        did,
        description: asString(rec.description) ?? null,
        createdAt: asString(rec.createdAt) ?? null,
        // Present when the account is labelled/taken down; explains a sudden
        // drop to zero posts far better than "ingest returned nothing".
        labels: asArray(rec.labels).length,
      },
    },
    audience: {
      day: toDayString(new Date()),
      followers,
      following: asCount(rec.followsCount),
      extra: { posts: asCount(rec.postsCount) },
    },
  };
}

/**
 * Decide the timestamp we will chart on. See the file header: `createdAt` is
 * whatever the posting client wrote, `indexedAt` is what the network saw.
 */
function resolvePostedAt(createdAt: Date | undefined, indexedAt: Date | undefined): Date | undefined {
  if (!createdAt) return indexedAt;
  if (!indexedAt) return createdAt;
  if (createdAt.getTime() > indexedAt.getTime() + CREATED_AT_TOLERANCE_MS) return indexedAt;
  return createdAt;
}

function toPost(feedItem: Record<string, unknown>, actorDid: string): NormalizedPost | undefined {
  const post = asRecord(feedItem.post);
  const uri = asString(post?.uri);
  const author = asRecord(post?.author);
  const authorDid = asString(author?.did);
  const record = asRecord(post?.record);
  if (!post || !uri || !record) return undefined;

  // Reposts of *other* people's posts arrive in the feed with a `reason` of
  // `#reasonRepost`. Their engagement belongs to the original author, so
  // counting them would inflate this competitor's numbers with someone else's
  // likes. They are dropped; a repost of one's own post is kept, since that is
  // a genuine re-publication decision.
  const reason = asString(asRecord(feedItem.reason)?.$type);
  if (reason?.includes('reasonRepost') && authorDid !== actorDid) return undefined;

  const postedAt = resolvePostedAt(asDate(record.createdAt), asDate(post.indexedAt));
  if (!postedAt) return undefined;

  const text = asString(record.text) ?? '';
  const embed = asRecord(post.embed) ?? asRecord(record.embed);
  const facets = harvestFacets(asArray(record.facets));
  const media = mediaFromEmbed(embed);
  const rkey = rkeyFromUri(uri);
  const handle = asString(author?.handle) ?? actorDid;

  // Facets are authoritative; the regex pass catches anything a client failed
  // to facet (older clients, cross-posting bridges) without duplicating.
  const hashtags = Array.from(new Set([...facets.tags, ...extractHashtags(text)]));
  const urls = Array.from(new Set([...facets.urls, ...extractUrls(text)]));

  const isReply = Boolean(asRecord(record.reply));
  const langs = asArray(record.langs).map((l) => asString(l)).filter((l): l is string => Boolean(l));

  return {
    externalId: uri,
    postedAt,
    type: typeFromEmbed(embed, text),
    text: text || null,
    permalink: rkey ? `https://bsky.app/profile/${handle}/post/${rkey}` : null,
    mediaUrl: media.mediaUrl,
    thumbnailUrl: media.thumbnailUrl,
    // The video embed exposes aspect ratio but never a duration.
    durationSec: null,
    language: langs[0] ?? null,
    hashtags,
    mentions: extractMentions(text),
    urls,
    applause: asCount(post.likeCount),
    conversation: asCount(post.replyCount),
    // Reposts and quote posts both put the post in front of a new audience.
    amplification: asCount(post.repostCount) + asCount(post.quoteCount),
    // Bluesky has no bookmarks and publishes no impressions to anyone.
    saves: 0,
    views: 0,
    raw: {
      cid: asString(post.cid) ?? null,
      isReply,
      isSelfRepost: Boolean(reason?.includes('reasonRepost')),
      mentionDids: facets.mentions,
      embedType: asString(embed?.$type) ?? null,
      indexedAt: asString(post.indexedAt) ?? null,
      recordCreatedAt: asString(record.createdAt) ?? null,
      langs,
    },
  };
}

/* ------------------------------------------------------------- adapter */

export const blueskyAdapter: ChannelAdapter = {
  platform: PLATFORM,
  displayName: 'Bluesky',
  accessNotes:
    'No credentials required. Reads the public AT Protocol appview at public.api.bsky.app, which serves '
    + 'full post and follower data for any public account. Bluesky publishes no impression or bookmark '
    + 'counts to anyone, so views and saves are always 0 and engagement rate is computed per follower only.',
  credentialFields: [],
  // The public appview is rate limited per IP (roughly 3,000 requests / 5 min).
  // Pacing to that rather than to a per-app quota, since there is no app.
  rateLimit: { callsPerWindow: 3_000, windowSeconds: 300 },
  worksUnauthenticated: true,

  /**
   * Accepts `https://bsky.app/profile/x`, `@x.bsky.social`, a bare handle, or a
   * raw DID. DIDs pass through untouched because they are the only identifier
   * that survives a handle change — which on Bluesky is a routine, self-serve
   * operation, not an exceptional event.
   */
  parseHandle(input: string): string {
    const trimmed = input.trim();
    if (!trimmed) throw new AdapterError('Empty Bluesky handle', { platform: PLATFORM, retryable: false });

    if (DID_RE.test(trimmed)) return trimmed;

    let candidate = trimmed;
    if (/^https?:\/\//i.test(trimmed)) {
      let url: URL;
      try {
        url = new URL(trimmed);
      } catch {
        throw new AdapterError(`Unparseable Bluesky URL: ${input}`, { platform: PLATFORM, retryable: false });
      }
      const segments = url.pathname.split('/').filter(Boolean);
      const idx = segments.indexOf('profile');
      const found = idx >= 0 ? segments[idx + 1] : segments[0];
      if (!found) throw new AdapterError(`No profile in URL: ${input}`, { platform: PLATFORM, retryable: false });
      candidate = found;
    }

    candidate = candidate.replace(/^@/, '').toLowerCase();
    if (DID_RE.test(candidate)) return candidate;
    // Handles are domain names; a bare word with no dot is not resolvable.
    if (!/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)+$/.test(candidate)) {
      throw new AdapterError(
        `"${input}" is not a Bluesky handle. Handles are domains, e.g. bostonglobe.bsky.social.`,
        { platform: PLATFORM, retryable: false },
      );
    }
    return candidate;
  },

  async resolveProfile(handle: string): Promise<AdapterProfile> {
    const body = await xrpc<unknown>('app.bsky.actor.getProfile', { actor: handle });
    return readProfile(body, handle).profile;
  },

  async fetch(ctx: FetchContext): Promise<FetchResult> {
    const actor = ctx.externalId ?? ctx.handle;
    const profileBody = await xrpc<unknown>('app.bsky.actor.getProfile', { actor }, ctx);
    const { profile, audience } = readProfile(profileBody, ctx.handle);

    const posts: NormalizedPost[] = [];
    const seen = new Set<string>();
    let cursor = typeof ctx.cursor.resumeCursor === 'string' ? ctx.cursor.resumeCursor : undefined;
    let pages = 0;
    let hasMore = false;
    let reachedWindow = false;

    while (pages < MAX_FEED_PAGES) {
      pages++;
      const body = await xrpc<unknown>('app.bsky.feed.getAuthorFeed', {
        actor: profile.externalId,
        limit: FEED_PAGE_SIZE,
        cursor,
        // Include the author's own reply threads: for a newsroom account,
        // replies are where the reporting conversation actually happens, and
        // omitting them understates both cadence and conversation volume.
        filter: 'posts_with_replies',
      }, ctx);

      const root = asRecord(body);
      const feed = asArray(root?.feed);
      let oldestOnPage: Date | undefined;

      for (const raw of feed) {
        const item = asRecord(raw);
        if (!item) continue;
        const post = toPost(item, profile.externalId);
        if (!post) continue;
        if (!oldestOnPage || post.postedAt < oldestOnPage) oldestOnPage = post.postedAt;
        if (post.postedAt < ctx.since) { reachedWindow = true; continue; }
        if (post.postedAt > ctx.until) continue;
        if (seen.has(post.externalId)) continue;
        seen.add(post.externalId);
        posts.push(post);
      }

      if (posts.length >= ctx.limit) {
        posts.length = ctx.limit;
        hasMore = true;
        break;
      }

      cursor = asString(root?.cursor);
      if (!cursor || feed.length === 0) break;
      // The feed is strictly reverse-chronological, so once a whole page sits
      // before `since` there is nothing left in the window.
      if (oldestOnPage && oldestOnPage < ctx.since) { reachedWindow = true; break; }
      if (pages >= MAX_FEED_PAGES) hasMore = true;
    }

    return {
      posts,
      audience: [audience],
      profile,
      cursor: {
        did: profile.externalId,
        handle: profile.handle,
        lastRunAt: new Date().toISOString(),
        // Only worth resuming from mid-history when we ran out of pages before
        // reaching the window; otherwise the next run starts from the top.
        resumeCursor: hasMore && !reachedWindow ? cursor ?? null : null,
      },
      hasMore,
    };
  },

  /**
   * No credentials to check, so this verifies the appview is actually reachable
   * from this server — which is the only thing that can be wrong.
   */
  async healthCheck(): Promise<{ ok: boolean; message: string }> {
    try {
      await xrpc<unknown>('app.bsky.actor.getProfile', { actor: 'bsky.app' });
      return { ok: true, message: 'Public Bluesky appview reachable. No credentials needed.' };
    } catch (err) {
      if (err instanceof AdapterError) return { ok: false, message: err.message };
      return { ok: false, message: err instanceof Error ? err.message : 'Unknown error' };
    }
  },
};

export default blueskyAdapter;
