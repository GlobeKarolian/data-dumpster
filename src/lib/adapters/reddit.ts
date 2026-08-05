/**
 * Reddit publisher user accounts via EnsembleData.
 *
 * Legacy stored subreddit rows remain readable so their history is not lost,
 * but new sources are user accounts only. User accounts are stored with an
 * explicit `u/` prefix so they cannot collide with those legacy rows.
 * `followers` means community members for subreddits. User accounts return no
 * audience observations: karma is not followers and is never a denominator.
 *
 * Reddit's public score is vote-fuzzed and is not a literal count of upvotes.
 * We store the platform-reported score as applause, comments as conversation,
 * and crossposts as amplification. Reddit does not expose post views or saves
 * through this feed, so both remain unavailable and are stored as 0.
 */
import type { Platform, PostType } from '@/lib/types';
import { ensembleGet, envelope } from '@/lib/vendors/ensembledata';
import {
  AdapterError,
  type AdapterProfile,
  type ChannelAdapter,
  type FetchContext,
  type FetchResult,
  type NormalizedAudience,
  type NormalizedPost,
} from './types';
import { extractHashtags, extractMentions, extractUrls, toDayString } from './util/normalize';
import { isRecord, num, pick, str, toDate } from './vendor-posts';

const PLATFORM: Platform = 'reddit';
const SUBREDDIT_ENDPOINT = '/reddit/subreddit/posts';
const USER_ENDPOINT = '/reddit/user/posts';
const MAX_PAGES = 20;

export type RedditEntityType = 'subreddit' | 'user';

export interface RedditTarget {
  entityType: RedditEntityType;
  name: string;
  /** Existing subreddits stay bare; user accounts are explicitly namespaced. */
  handle: string;
}

interface ParsedRedditPage {
  posts: NormalizedPost[];
  profile?: AdapterProfile;
  audience?: NormalizedAudience;
  nextCursor?: string;
  rowCount: number;
  matchedCount: number;
  malformedCount: number;
  oldest?: Date;
}

export interface ParsedRedditUserPage {
  posts: NormalizedPost[];
  profile?: AdapterProfile;
  nextCursor?: string;
  rowCount: number;
  matchedCount: number;
  malformedCount: number;
  oldest?: Date;
}

export interface ParseRedditPageOptions {
  handle: string;
  since: Date;
  until: Date;
  observedAt?: Date;
  limit?: number;
}

function hasOwn(row: Record<string, unknown>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(row, key);
}

/** Reddit's source-native fullname prefixes distinguish account namespaces. */
function stableRedditIdentity(
  value: unknown,
  entityType: RedditEntityType,
): string | undefined {
  const candidate = str(value);
  if (!candidate) return undefined;
  const pattern = entityType === 'user' ? /^t2_[a-z0-9]+$/i : /^t5_[a-z0-9]+$/i;
  return pattern.test(candidate)
    ? candidate
    : undefined;
}

function decodeRedditUrl(value: string | undefined): string | undefined {
  return value
    ?.replace(/&amp;/gi, '&')
    .replace(/&#0*38;/gi, '&')
    .replace(/&#x0*26;/gi, '&');
}

function httpUrl(value: unknown): string | undefined {
  const candidate = decodeRedditUrl(str(value));
  if (!candidate) return undefined;
  try {
    const url = new URL(candidate);
    return url.protocol === 'http:' || url.protocol === 'https:'
      ? url.toString()
      : undefined;
  } catch {
    return undefined;
  }
}

function redditHost(hostname: string): boolean {
  const host = hostname.toLowerCase();
  return host === 'redd.it'
    || host.endsWith('.redd.it')
    || host === 'reddit.com'
    || host.endsWith('.reddit.com');
}

function validSubreddit(name: string): boolean {
  return /^[a-z0-9_]{2,21}$/.test(name);
}

function validUsername(name: string): boolean {
  return /^[a-z0-9_-]{2,20}$/.test(name);
}

/**
 * Preserve the existing bare-subreddit contract while giving user accounts a
 * collision-free canonical identity.
 */
export function parseRedditTarget(
  input: string,
  bareEntityType: RedditEntityType = 'subreddit',
): RedditTarget {
  const trimmed = input.trim();
  if (!trimmed) {
    throw new AdapterError('Empty Reddit source', {
      platform: PLATFORM,
      retryable: false,
    });
  }

  let entityType: RedditEntityType = bareEntityType;
  let candidate = trimmed;

  if (/^https?:\/\//i.test(trimmed)) {
    let url: URL;
    try {
      url = new URL(trimmed);
    } catch {
      throw new AdapterError('Unparseable Reddit URL: ' + input, {
        platform: PLATFORM,
        retryable: false,
      });
    }
    if (!redditHost(url.hostname)) {
      throw new AdapterError('Not a Reddit URL: ' + input, {
        platform: PLATFORM,
        retryable: false,
      });
    }

    const segments = url.pathname.split('/').filter(Boolean);
    const namespace = segments[0]?.toLowerCase();
    if (namespace === 'r' && segments[1]) {
      entityType = 'subreddit';
      candidate = segments[1];
    } else if ((namespace === 'u' || namespace === 'user') && segments[1]) {
      entityType = 'user';
      candidate = segments[1];
    } else {
      throw new AdapterError('No Reddit community or user account in URL: ' + input, {
        platform: PLATFORM,
        retryable: false,
      });
    }
  } else {
    const shorthand = trimmed.match(/^\/?(r|u|user)\/(.+?)\/?$/i);
    if (shorthand) {
      entityType = shorthand[1].toLowerCase() === 'r' ? 'subreddit' : 'user';
      candidate = shorthand[2];
    }
  }

  const name = candidate.replace(/\/+$/, '').toLowerCase();
  const valid = entityType === 'user' ? validUsername(name) : validSubreddit(name);
  if (!valid) {
    throw new AdapterError(
      'Invalid Reddit ' + (entityType === 'user' ? 'username' : 'subreddit') + ': ' + input,
      { platform: PLATFORM, retryable: false },
    );
  }

  return {
    entityType,
    name,
    handle: entityType === 'user' ? 'u/' + name : name,
  };
}

function isExternalUrl(value: string): boolean {
  try {
    return !redditHost(new URL(value).hostname);
  } catch {
    return false;
  }
}

function dedupe(values: Array<string | undefined>): string[] {
  return Array.from(new Set(values.filter((value): value is string => Boolean(value))));
}

function canonicalPermalink(row: Record<string, unknown>, handle: string, id: string): string {
  const raw = decodeRedditUrl(str(row.permalink));
  if (raw) {
    if (/^https?:\/\//i.test(raw)) return raw;
    return 'https://www.reddit.com' + (raw.startsWith('/') ? raw : '/' + raw);
  }
  return 'https://www.reddit.com/r/' + handle + '/comments/' + id;
}

function nestedRedditVideo(row: Record<string, unknown>): Record<string, unknown> | undefined {
  const secureMedia = isRecord(row.secure_media) ? row.secure_media : undefined;
  const media = isRecord(row.media) ? row.media : undefined;
  return (secureMedia && isRecord(secureMedia.reddit_video)
    ? secureMedia.reddit_video
    : undefined)
    ?? (media && isRecord(media.reddit_video) ? media.reddit_video : undefined);
}

function previewSource(row: Record<string, unknown>): string | undefined {
  const preview = isRecord(row.preview) ? row.preview : undefined;
  const images = preview && Array.isArray(preview.images) ? preview.images : [];
  const first = isRecord(images[0]) ? images[0] : undefined;
  const source = first && isRecord(first.source) ? first.source : undefined;
  return httpUrl(source?.url);
}

function gallerySource(row: Record<string, unknown>): string | undefined {
  const metadata = isRecord(row.media_metadata) ? row.media_metadata : undefined;
  if (!metadata) return undefined;

  for (const value of Object.values(metadata)) {
    if (!isRecord(value)) continue;
    const source = isRecord(value.s) ? value.s : undefined;
    const full = httpUrl(source?.u);
    if (full) return full;

    const previews = Array.isArray(value.p) ? value.p : [];
    const largest = previews
      .filter(isRecord)
      .sort((a, b) => num(b.x) - num(a.x))[0];
    const fallback = httpUrl(largest?.u);
    if (fallback) return fallback;
  }
  return undefined;
}

function fallbackThumbnail(row: Record<string, unknown>): string | undefined {
  return httpUrl(row.thumbnail);
}

function isDirectImage(row: Record<string, unknown>, target: string | undefined): boolean {
  const hint = str(row.post_hint)?.toLowerCase();
  if (hint === 'image') return true;
  if (str(row.domain)?.toLowerCase() === 'i.redd.it') return true;
  if (!target) return false;
  try {
    return /\.(?:avif|gif|jpe?g|png|webp)(?:$|[?#])/i.test(new URL(target).pathname);
  } catch {
    return false;
  }
}

function postType(row: Record<string, unknown>, target: string | undefined): PostType {
  const hint = str(row.post_hint)?.toLowerCase() ?? '';
  if (row.is_video === true || nestedRedditVideo(row) || hint.includes('video')) return 'video';

  const metadata = isRecord(row.media_metadata) ? row.media_metadata : undefined;
  const gallery = row.is_gallery === true
    || isRecord(row.gallery_data)
    || (metadata !== undefined && Object.keys(metadata).length > 1);
  if (gallery) return 'carousel';
  if (isDirectImage(row, target)) return 'photo';
  if (row.is_self === true) return 'text';
  return 'link';
}

function toPost(
  row: Record<string, unknown>,
  handle: string,
  since: Date,
  until: Date,
): NormalizedPost | undefined {
  const externalId = str(pick(row, ['id', 'name']));
  const postedAt = toDate(row.created_utc);
  if (!externalId || !postedAt || postedAt < since || postedAt > until) return undefined;

  const title = str(row.title);
  const selftext = str(row.selftext);
  const text = [title, selftext].filter((part): part is string => Boolean(part)).join('\n\n');
  const target = httpUrl(row.url);
  const type = postType(row, target);
  const preview = previewSource(row);
  const gallery = gallerySource(row);
  const video = nestedRedditVideo(row);
  const videoUrl = httpUrl(video?.fallback_url);
  const imageUrl = isDirectImage(row, target) ? target : undefined;

  let mediaUrl: string | null = null;
  if (type === 'video') mediaUrl = videoUrl ?? null;
  else if (type === 'photo') mediaUrl = imageUrl ?? preview ?? null;
  else if (type === 'carousel') mediaUrl = gallery ?? preview ?? null;

  const externalTarget = target && isExternalUrl(target) ? target : undefined;
  const textUrls = extractUrls(text).filter(isExternalUrl);
  const duration = num(video?.duration);

  return {
    externalId,
    postedAt,
    type,
    text: text || null,
    permalink: canonicalPermalink(row, handle, externalId),
    mediaUrl,
    thumbnailUrl: preview ?? gallery ?? fallbackThumbnail(row) ?? null,
    durationSec: duration > 0 ? duration : null,
    language: null,
    hashtags: extractHashtags(text),
    mentions: extractMentions(text),
    urls: dedupe([externalTarget, ...textUrls]),
    // Reddit's score is vote-fuzzed. `ups` is only a fallback when score is
    // absent; a genuine score of zero must stay zero.
    applause: num(pick(row, ['score', 'ups'])),
    conversation: num(row.num_comments),
    amplification: num(row.num_crossposts),
    saves: 0,
    views: 0,
    raw: row,
  };
}

function profileFromRow(
  row: Record<string, unknown>,
  handle: string,
): AdapterProfile | undefined {
  const externalId = stableRedditIdentity(row.subreddit_id, 'subreddit');
  if (!externalId) return undefined;
  const subscribersPresent = hasOwn(row, 'subreddit_subscribers');
  return {
    externalId,
    handle,
    displayName: str(row.subreddit_name_prefixed) ?? 'r/' + handle,
    avatarUrl: null,
    profileUrl: 'https://www.reddit.com/r/' + handle + '/',
    ...(subscribersPresent ? { followers: num(row.subreddit_subscribers) } : {}),
    meta: {
      source: 'ensembledata',
      redditEntityType: 'subreddit',
      audienceAvailable: subscribersPresent,
      subredditType: str(row.subreddit_type) ?? null,
      over18: row.over_18 === true,
    },
  };
}

function profileFromUserRow(
  row: Record<string, unknown>,
  username: string,
): AdapterProfile | undefined {
  const externalId = stableRedditIdentity(row.author_fullname, 'user');
  if (!externalId) return undefined;
  return {
    externalId,
    handle: 'u/' + username,
    displayName: 'u/' + (str(row.author) ?? username),
    avatarUrl: null,
    profileUrl: 'https://www.reddit.com/user/' + encodeURIComponent(username) + '/',
    meta: {
      source: 'ensembledata',
      redditEntityType: 'user',
      audienceAvailable: false,
      // subreddit_subscribers is deliberately excluded: it belongs to the
      // community containing a post, not to the author account.
      premium: row.author_premium === true,
    },
  };
}

function mergeRedditProfile(
  current: AdapterProfile | undefined,
  candidate: AdapterProfile | undefined,
  target: string,
): AdapterProfile | undefined {
  if (!candidate) return current;
  if (current && current.externalId !== candidate.externalId) {
    throw new AdapterError(
      'EnsembleData returned conflicting source-native ids for ' + target + ': `'
        + current.externalId + '` and `' + candidate.externalId
        + '`. No observations were accepted.',
      { platform: PLATFORM, retryable: false },
    );
  }
  return current ?? candidate;
}

/**
 * Parse the live `{data:{nextCursor,posts:[{kind,data}]}}` response without I/O.
 * Kept public so a sanitized observed payload can lock the vendor contract down
 * in tests without ever recording a token.
 */
export function parseRedditPage(
  body: unknown,
  opts: ParseRedditPageOptions,
): ParsedRedditPage {
  const payload = envelope<unknown>(body);
  const root = isRecord(payload) ? payload : {};
  const rows = Array.isArray(root.posts) ? root.posts : [];
  const observedAt = opts.observedAt ?? new Date();
  const canonicalHandle = opts.handle.toLowerCase();
  const posts: NormalizedPost[] = [];
  let profile: AdapterProfile | undefined;
  let audience: NormalizedAudience | undefined;
  let matchedCount = 0;
  let malformedCount = 0;
  let oldest: Date | undefined;

  for (const raw of rows) {
    if (!isRecord(raw)) {
      malformedCount++;
      continue;
    }
    const row = isRecord(raw.data) ? raw.data : raw;
    const subreddit = str(row.subreddit)?.toLowerCase();
    if (subreddit !== canonicalHandle) continue;
    matchedCount++;

    const postedAt = toDate(row.created_utc);
    if (postedAt && (!oldest || postedAt < oldest)) oldest = postedAt;

    profile = mergeRedditProfile(
      profile,
      profileFromRow(row, canonicalHandle),
      'r/' + canonicalHandle,
    );
    if (!audience && hasOwn(row, 'subreddit_subscribers')) {
      audience = {
        day: toDayString(observedAt),
        followers: num(row.subreddit_subscribers),
        following: null,
        extra: {},
      };
    }

    const post = toPost(row, canonicalHandle, opts.since, opts.until);
    if (post) posts.push(post);
    else if (!postedAt || !str(pick(row, ['id', 'name']))) malformedCount++;
  }

  posts.sort((a, b) => b.postedAt.getTime() - a.postedAt.getTime());
  if (matchedCount > 0 && !profile) {
    throw new AdapterError(
      'EnsembleData returned posts for r/' + canonicalHandle
        + ' without a source-native subreddit id (`t5_...`). The mutable subreddit name cannot '
        + 'replace it; no observations were accepted.',
      { platform: PLATFORM, retryable: false },
    );
  }
  const limit = opts.limit === undefined
    ? posts.length
    : Math.max(0, Math.trunc(opts.limit));

  return {
    posts: posts.slice(0, limit),
    profile,
    audience,
    nextCursor: str(root.nextCursor),
    rowCount: rows.length,
    matchedCount,
    malformedCount,
    oldest,
  };
}

/**
 * Parse the observed live Reddit author feed. EnsembleData does not currently
 * publish this route in its OpenAPI document, so this parser is locked to the
 * real `{data:{posts:[{kind,data}],nextCursor}}` response instead.
 */
export function parseRedditUserPage(
  body: unknown,
  opts: ParseRedditPageOptions,
): ParsedRedditUserPage {
  const payload = envelope<unknown>(body);
  const root = isRecord(payload) ? payload : {};
  const rows = Array.isArray(root.posts) ? root.posts : [];
  const username = opts.handle.toLowerCase();
  const posts: NormalizedPost[] = [];
  let profile: AdapterProfile | undefined;
  let matchedCount = 0;
  let malformedCount = 0;
  let oldest: Date | undefined;

  for (const raw of rows) {
    if (!isRecord(raw)) {
      malformedCount++;
      continue;
    }
    const row = isRecord(raw.data) ? raw.data : raw;
    const author = str(row.author)?.replace(/^u\//i, '').toLowerCase();
    if (author !== username) continue;
    matchedCount++;

    const postedAt = toDate(row.created_utc);
    if (postedAt && (!oldest || postedAt < oldest)) oldest = postedAt;
    profile = mergeRedditProfile(
      profile,
      profileFromUserRow(row, username),
      'u/' + username,
    );

    const subreddit = str(row.subreddit)?.toLowerCase() ?? username;
    const post = toPost(row, subreddit, opts.since, opts.until);
    if (post) {
      post.raw = {
        ...row,
        _dataDumpster: {
          redditEntityType: 'user',
          source: 'ensembledata',
          reportedMetrics: {
            score: hasOwn(row, 'score') || hasOwn(row, 'ups'),
            comments: hasOwn(row, 'num_comments'),
            crossposts: hasOwn(row, 'num_crossposts'),
            views: false,
            saves: false,
          },
        },
      };
      posts.push(post);
    } else if (!postedAt || !str(pick(row, ['id', 'name']))) {
      malformedCount++;
    }
  }

  posts.sort((a, b) => b.postedAt.getTime() - a.postedAt.getTime());
  if (matchedCount > 0 && !profile) {
    throw new AdapterError(
      'EnsembleData returned posts for u/' + username
        + ' without a source-native author id (`t2_...`). The mutable username cannot replace it; '
        + 'no observations were accepted.',
      { platform: PLATFORM, retryable: false },
    );
  }
  const limit = opts.limit === undefined
    ? posts.length
    : Math.max(0, Math.trunc(opts.limit));

  return {
    posts: posts.slice(0, limit),
    profile,
    nextCursor: str(root.nextCursor),
    rowCount: rows.length,
    matchedCount,
    malformedCount,
    oldest,
  };
}

function requireToken(credentials: Record<string, string>): string {
  const token = credentials.ensembleDataToken?.trim()
    || process.env.ENSEMBLEDATA_TOKEN?.trim()
    || '';
  if (!token) {
    throw new AdapterError(
      'Reddit sources require an EnsembleData token. Set ENSEMBLEDATA_TOKEN '
      + 'or save an EnsembleData token for Reddit in Social Profiles.',
      { platform: PLATFORM, retryable: false },
    );
  }
  return token;
}

async function readPage(
  handle: string,
  token: string,
  cursor?: string,
  ctx?: Pick<FetchContext, 'onApiCall' | 'signal'>,
): Promise<unknown> {
  return ensembleGet(SUBREDDIT_ENDPOINT, {
    name: handle,
    sort: 'new',
    period: 'hour',
    cursor,
  }, {
    token,
    platform: PLATFORM,
    onApiCall: ctx?.onApiCall,
    signal: ctx?.signal,
  });
}

async function readUserPage(
  username: string,
  token: string,
  cursor?: string,
  ctx?: Pick<FetchContext, 'onApiCall' | 'signal'>,
): Promise<unknown> {
  return ensembleGet(USER_ENDPOINT, {
    name: username,
    sort: 'new',
    period: 'all',
    cursor,
  }, {
    token,
    platform: PLATFORM,
    onApiCall: ctx?.onApiCall,
    signal: ctx?.signal,
  });
}

function resumableCursor(ctx: FetchContext, handle: string): string | undefined {
  const next = str(ctx.cursor.nextCursor);
  if (!next) return undefined;

  const cursorHandle = str(ctx.cursor.subreddit);
  if (cursorHandle && cursorHandle.toLowerCase() !== handle) return undefined;

  const since = str(ctx.cursor.windowSince);
  const until = str(ctx.cursor.windowUntil);
  if (!since && !until) return next;
  return since === ctx.since.toISOString() && until === ctx.until.toISOString()
    ? next
    : undefined;
}

function resumableUserCursor(ctx: FetchContext, username: string): string | undefined {
  const next = str(ctx.cursor.nextCursor);
  if (!next) return undefined;

  const cursorUsername = str(ctx.cursor.username);
  if (cursorUsername && cursorUsername.toLowerCase() !== username) return undefined;

  const since = str(ctx.cursor.windowSince);
  const until = str(ctx.cursor.windowUntil);
  if (!since && !until) return next;
  return since === ctx.since.toISOString() && until === ctx.until.toISOString()
    ? next
    : undefined;
}

async function fetchUserAccount(ctx: FetchContext, username: string): Promise<FetchResult> {
  const token = requireToken(ctx.credentials);
  const limit = Math.max(0, Math.trunc(ctx.limit));
  const posts = new Map<string, NormalizedPost>();
  const warnings: string[] = [];
  const observedAt = new Date();
  let profile: AdapterProfile | undefined;
  let pageCursor = resumableUserCursor(ctx, username);
  let nextCursor: string | undefined;
  let pages = 0;
  let reachedWindowStart = false;
  let totalRows = 0;
  let totalMatched = 0;
  let malformed = 0;
  let oldest: Date | undefined;
  let droppedForLimit = false;

  do {
    pages++;
    const body = await readUserPage(username, token, pageCursor, ctx);
    const parsed = parseRedditUserPage(body, {
      handle: username,
      since: ctx.since,
      until: ctx.until,
      observedAt,
    });

    totalRows += parsed.rowCount;
    totalMatched += parsed.matchedCount;
    malformed += parsed.malformedCount;
    if (parsed.oldest && (!oldest || parsed.oldest < oldest)) oldest = parsed.oldest;
    if (parsed.oldest && parsed.oldest < ctx.since) reachedWindowStart = true;
    profile = mergeRedditProfile(profile, parsed.profile, 'u/' + username);

    for (const post of parsed.posts) {
      if (posts.has(post.externalId)) continue;
      if (posts.size >= limit) {
        droppedForLimit = true;
        break;
      }
      posts.set(post.externalId, post);
    }

    nextCursor = parsed.nextCursor;
    if (posts.size >= limit) break;
    if (!nextCursor || parsed.rowCount === 0 || reachedWindowStart) break;
    pageCursor = nextCursor;
  } while (pages < MAX_PAGES);

  const hasMore = !reachedWindowStart
    && Boolean(nextCursor)
    && (posts.size >= limit || pages >= MAX_PAGES || droppedForLimit);

  if (totalRows > 0 && totalMatched === 0) {
    throw new AdapterError(
      'EnsembleData returned Reddit posts, but none matched u/' + username + ' exactly.',
      { platform: PLATFORM, retryable: false },
    );
  }
  if (totalRows === 0 && !stableRedditIdentity(ctx.externalId, 'user')) {
    throw new AdapterError(
      'EnsembleData returned an empty Reddit feed for u/' + username
        + ' and offers no dedicated user-profile endpoint, so its stable `t2_...` identity could '
        + 'not be resolved. No observations were accepted; retry after the account has a public '
        + 'submission or the source exposes profile identity.',
      { platform: PLATFORM, retryable: true },
    );
  }
  if (malformed > 0) {
    warnings.push(
      'Reddit for u/' + username + ': ignored ' + String(malformed)
      + ' malformed post ' + (malformed === 1 ? 'row.' : 'rows.'),
    );
  }
  const incompleteReason = totalRows === 0
    ? 'EnsembleData returned an empty Reddit user feed without a terminal completeness marker. '
      + 'The requested window is unmeasured rather than certified empty.'
    : hasMore
    ? 'Reddit for u/' + username + ': stopped after ' + String(pages)
      + ' page' + (pages === 1 ? '' : 's')
      + ' before the requested window was fully covered. Resume the saved vendor cursor; older posts are unobserved, not absent.'
    : oldest && oldest > ctx.since && totalRows > 0 && !nextCursor
      ? 'Reddit for u/' + username + ': the vendor feed only reached back to '
        + toDayString(oldest) + ', short of the requested window and exposed no continuation cursor. Older posts are unobserved, not absent.'
      : undefined;
  if (incompleteReason) warnings.push(incompleteReason);

  return {
    posts: Array.from(posts.values())
      .sort((a, b) => b.postedAt.getTime() - a.postedAt.getTime()),
    audience: [],
    profile,
    cursor: {
      source: 'ensembledata',
      redditEntityType: 'user',
      username,
      windowSince: ctx.since.toISOString(),
      windowUntil: ctx.until.toISOString(),
      nextCursor: hasMore ? nextCursor ?? null : null,
      lastRunAt: observedAt.toISOString(),
    },
    ...(hasMore
      ? { hasMore: true as const, exhaustive: false as const, incompleteReason: incompleteReason as string }
      : incompleteReason
        ? { hasMore: false as const, exhaustive: false as const, incompleteReason }
        : { hasMore: false as const, exhaustive: true as const }),
    warnings: warnings.length > 0 ? warnings : undefined,
  };
}

export const redditAdapter: ChannelAdapter = {
  platform: PLATFORM,
  displayName: 'Reddit',
  accessNotes:
    'Reads public publisher user accounts through EnsembleData. Add u/username or a Reddit user URL. '
    + 'Legacy subreddit rows remain readable for retained history, but new communities cannot be added. '
    + 'Reddit user accounts do not expose a '
    + 'trustworthy public follower stock here, so account audience and follower-rate metrics stay '
    + 'blank. Applause is Reddit\'s vote-fuzzed post score and conversation is comments. Crossposts '
    + 'are shown only when the source reports them. Reddit does not expose post views or saves here. '
    + 'Commercial Reddit data use requires permission under Reddit\'s current terms; confirm that '
    + 'the vendor contract covers this use before enabling production collection.',
  credentialFields: [
    {
      key: 'ensembleDataToken',
      label: 'EnsembleData token',
      secret: true,
      required: true,
      help: 'Required for Reddit user accounts and post history.',
    },
  ],
  rateLimit: { callsPerWindow: 100, windowSeconds: 60 },
  worksUnauthenticated: false,

  parseHandle(input: string): string {
    const target = parseRedditTarget(input, 'user');
    if (target.entityType === 'subreddit') {
      throw new AdapterError(
        'Reddit sources must be user accounts such as u/bostonglobe or https://reddit.com/user/bostonglobe, not subreddits.',
        { platform: PLATFORM, retryable: false },
      );
    }
    return target.handle;
  },

  async resolveProfile(
    handle: string,
    credentials: Record<string, string>,
  ): Promise<AdapterProfile> {
    const target = parseRedditTarget(handle, 'user');
    if (target.entityType === 'user') {
      const body = await readUserPage(target.name, requireToken(credentials));
      const parsed = parseRedditUserPage(body, {
        handle: target.name,
        since: new Date(0),
        until: new Date(8_640_000_000_000_000),
        limit: 0,
      });
      if (parsed.profile) return parsed.profile;
      throw new AdapterError(
        'EnsembleData returned an empty feed for u/' + target.name
        + ' and has no dedicated user-profile endpoint, so it cannot resolve the source-native '
        + '`t2_...` account id yet. The account may be legitimate but have no public submissions; '
        + 'retry later rather than binding its mutable username as identity.',
        { platform: PLATFORM, retryable: true },
      );
    }

    const canonical = target.name;
    const body = await readPage(canonical, requireToken(credentials));
    const parsed = parseRedditPage(body, {
      handle: canonical,
      since: new Date(0),
      until: new Date(8_640_000_000_000_000),
      limit: 0,
    });
    if (!parsed.profile) {
      throw new AdapterError(
        'EnsembleData returned an empty feed for r/' + canonical
        + ' and has no dedicated subreddit-profile endpoint, so it cannot resolve the '
        + 'source-native `t5_...` id yet. Retry later rather than binding the mutable name as identity.',
        { platform: PLATFORM, retryable: true },
      );
    }
    return parsed.profile;
  },

  async fetch(ctx: FetchContext): Promise<FetchResult> {
    // Bare stored handles predate user-account support and mean subreddits.
    const target = parseRedditTarget(ctx.handle, 'subreddit');
    if (target.entityType === 'user') {
      return fetchUserAccount(ctx, target.name);
    }

    const handle = target.name;
    const token = requireToken(ctx.credentials);
    const limit = Math.max(0, Math.trunc(ctx.limit));
    const posts = new Map<string, NormalizedPost>();
    const warnings: string[] = [];
    const observedAt = new Date();
    let profile: AdapterProfile | undefined;
    let audience: NormalizedAudience | undefined;
    let pageCursor = resumableCursor(ctx, handle);
    let nextCursor: string | undefined;
    let pages = 0;
    let reachedWindowStart = false;
    let totalRows = 0;
    let totalMatched = 0;
    let malformed = 0;
    let oldest: Date | undefined;
    let droppedForLimit = false;

    do {
      pages++;
      const body = await readPage(handle, token, pageCursor, ctx);
      const parsed = parseRedditPage(body, {
        handle,
        since: ctx.since,
        until: ctx.until,
        observedAt,
      });

      totalRows += parsed.rowCount;
      totalMatched += parsed.matchedCount;
      malformed += parsed.malformedCount;
      if (parsed.oldest && (!oldest || parsed.oldest < oldest)) oldest = parsed.oldest;
      if (parsed.oldest && parsed.oldest < ctx.since) reachedWindowStart = true;
      profile = mergeRedditProfile(profile, parsed.profile, 'r/' + handle);
      audience ??= parsed.audience;

      for (const post of parsed.posts) {
        if (posts.has(post.externalId)) continue;
        if (posts.size >= limit) {
          droppedForLimit = true;
          break;
        }
        posts.set(post.externalId, post);
      }

      nextCursor = parsed.nextCursor;
      if (posts.size >= limit) break;
      if (!nextCursor || parsed.rowCount === 0 || reachedWindowStart) break;
      pageCursor = nextCursor;
    } while (pages < MAX_PAGES);

    const hasMore = !reachedWindowStart
      && Boolean(nextCursor)
      && (posts.size >= limit || pages >= MAX_PAGES || droppedForLimit);

    if (totalRows > 0 && totalMatched === 0) {
      throw new AdapterError(
        'EnsembleData returned Reddit posts, but none matched r/' + handle + ' exactly.',
        { platform: PLATFORM, retryable: false },
      );
    }
    if (totalRows === 0 && !stableRedditIdentity(ctx.externalId, 'subreddit')) {
      throw new AdapterError(
        'EnsembleData returned an empty Reddit feed for r/' + handle
          + ' and offers no dedicated subreddit-profile endpoint, so its stable `t5_...` identity '
          + 'could not be resolved. No observations were accepted; retry after the source exposes '
          + 'a public row with native identity.',
        { platform: PLATFORM, retryable: true },
      );
    }
    if (malformed > 0) {
      warnings.push(
        'Reddit for r/' + handle + ': ignored ' + String(malformed)
        + ' malformed post ' + (malformed === 1 ? 'row.' : 'rows.'),
      );
    }
    const incompleteReason = totalRows === 0
      ? 'EnsembleData returned an empty Reddit subreddit feed without a terminal completeness '
        + 'marker. The requested window is unmeasured rather than certified empty.'
      : hasMore
      ? 'Reddit for r/' + handle + ': stopped after ' + String(pages)
        + ' page' + (pages === 1 ? '' : 's')
        + ' before the requested window was fully covered. Resume the saved vendor cursor; older posts are unobserved, not absent.'
      : oldest && oldest > ctx.since && totalRows > 0 && !nextCursor
        ? 'Reddit for r/' + handle + ': the vendor feed only reached back to '
          + toDayString(oldest) + ', short of the requested window and exposed no continuation cursor. Older posts are unobserved, not absent.'
        : undefined;
    if (incompleteReason) warnings.push(incompleteReason);

    return {
      posts: Array.from(posts.values())
        .sort((a, b) => b.postedAt.getTime() - a.postedAt.getTime()),
      audience: audience ? [audience] : [],
      profile,
      cursor: {
        source: 'ensembledata',
        redditEntityType: 'subreddit',
        subreddit: handle,
        windowSince: ctx.since.toISOString(),
        windowUntil: ctx.until.toISOString(),
        nextCursor: hasMore ? nextCursor ?? null : null,
        lastRunAt: observedAt.toISOString(),
      },
      ...(hasMore
        ? { hasMore: true as const, exhaustive: false as const, incompleteReason: incompleteReason as string }
        : incompleteReason
          ? { hasMore: false as const, exhaustive: false as const, incompleteReason }
          : { hasMore: false as const, exhaustive: true as const }),
      warnings: warnings.length > 0 ? warnings : undefined,
    };
  },

  async healthCheck(
    credentials: Record<string, string>,
  ): Promise<{ ok: boolean; message: string }> {
    const hasEnsemble = Boolean(
      credentials.ensembleDataToken?.trim() || process.env.ENSEMBLEDATA_TOKEN?.trim(),
    );
    if (!hasEnsemble) {
      return {
        ok: false,
        message: 'Add an EnsembleData token for Reddit communities and user accounts.',
      };
    }

    const checks: Array<{ ok: boolean; message: string }> = [];
    try {
      const body = await readUserPage('spez', requireToken(credentials));
      const payload = envelope<unknown>(body);
      const root = isRecord(payload) ? payload : undefined;
      checks.push(
        root && Array.isArray(root.posts)
          ? { ok: true, message: 'Reddit user accounts and communities ready' }
          : { ok: false, message: 'EnsembleData returned an unfamiliar Reddit response' },
      );
    } catch (error) {
      checks.push({
        ok: false,
        message: error instanceof Error ? error.message : 'unknown EnsembleData error',
      });
    }

    return {
      ok: checks.every((check) => check.ok),
      message: checks.map((check) => check.message).join('; ') + '.',
    };
  },
};

export default redditAdapter;
