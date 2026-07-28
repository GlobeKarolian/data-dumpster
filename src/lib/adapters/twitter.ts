/**
 * X (Twitter) — API v2.
 *
 * THE COST, STATED PLAINLY, BECAUSE IT DRIVES EVERY DECISION IN THIS FILE:
 *
 * X has no free read tier, and in February 2026 it replaced the subscription
 * tiers with metered credits. The reported shape of the current model is around
 * half a cent per post read, with a hard ceiling near two million reads a month
 * before an Enterprise contract is required. The old subscriptions still exist
 * for accounts that had them: Basic at roughly $200 a month for on the order of
 * 10,000 posts read, Pro at roughly $5,000 a month for on the order of a
 * million, Enterprise negotiated from tens of thousands. Basic subscribers have
 * been migrated onto metering.
 *
 * Every one of those figures is second-hand and X has changed them repeatedly
 * with little notice. Treat them as an order of magnitude, not a quote, and read
 * the developer portal before committing budget. See docs/DATA-ACCESS.md.
 *
 * Either way the economics are identical: every post read costs money, and
 * re-reading a post to refresh its engagement counts costs again. So:
 *
 *  - The window is server-side (start_time / end_time) and the per-run cap is
 *    respected strictly. We never page "just to be safe".
 *  - The newest tweet id from the previous run is kept on the cursor and passed
 *    as since_id, so an incremental run costs only what is new.
 *  - Retweets are excluded from the timeline query. A retweet on someone else's
 *    content is not a post by this account for cadence purposes, and each one
 *    would cost a tweet against the cap.
 *
 * WHAT THE METRICS MEAN HERE:
 *  - like_count      -> applause
 *  - reply_count     -> conversation
 *  - retweet_count + quote_count -> amplification (both are "someone put this in
 *    front of their own audience", which is what amplification means everywhere
 *    else in this product)
 *  - bookmark_count  -> saves
 *  - impression_count -> views, BUT it is only populated for tweets from the
 *    authenticating user. For every competitor account it is absent, and we
 *    store 0. Any view-based rate on a competitor X account is therefore
 *    undefined, not zero, and the metrics layer must say so.
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

const PLATFORM: Platform = 'twitter';
const API = 'https://api.x.com/2';

/** max_results ceiling on the user timeline endpoint. */
const TIMELINE_PAGE_SIZE = 100;
/** Hard stop. At 100 tweets a page this is 1,500 tweets, 15% of a month of Basic. */
const MAX_PAGES = 15;

const TWEET_FIELDS = 'public_metrics,created_at,entities,attachments,lang,referenced_tweets,note_tweet';
const USER_FIELDS = 'public_metrics,profile_image_url,description,verified_type,created_at';
const EXPANSIONS = 'attachments.media_keys';
const MEDIA_FIELDS = 'type,duration_ms,preview_image_url,url';

/* ------------------------------------------------------------- transport */

function requireBearer(credentials: Record<string, string>): string {
  const token = credentials.bearerToken?.trim();
  if (!token) {
    throw new AdapterError(
      'X requires an API v2 Bearer token from a paid developer project. The free tier cannot read '
      + 'timelines at all.',
      { platform: PLATFORM, retryable: false },
    );
  }
  return token;
}

/**
 * X sends a clean 429 with x-rate-limit-reset as an absolute unix second, and
 * no Retry-After header at all. Without this the shared client would fall back
 * to blind exponential backoff and usually retry before the window rolls.
 */
function xRetryAfter(headers: Headers): number | undefined {
  const reset = headers.get('x-rate-limit-reset');
  if (!reset) return undefined;
  const at = Number(reset);
  if (!Number.isFinite(at)) return undefined;
  return Math.max(0, Math.ceil(at - Date.now() / 1000));
}

/**
 * 403 on X means "your access tier does not include this", which no amount of
 * retrying fixes and which is the single most common failure for a newsroom
 * that just downgraded a plan. It gets a message that names the cause.
 */
function classifyXError(ctx: { status: number }): boolean | undefined {
  if (ctx.status === 403) return false;
  return undefined;
}

function xErrorMessage(parsed: unknown, body: string): string | undefined {
  const rec = asRecord(parsed);
  const detail = asString(rec?.detail);
  const title = asString(rec?.title);
  if (detail && title) return `${title}: ${detail}`;
  if (detail ?? title) return detail ?? title;
  // Partial-failure envelope: HTTP 200 with an errors array. The caller checks
  // for it separately, but a 4xx can carry the same shape.
  const first = asRecord(asArray(rec?.errors)[0]);
  const firstDetail = asString(first?.detail) ?? asString(first?.message);
  if (firstDetail) return firstDetail;
  return body.trim() ? body.slice(0, 300) : undefined;
}

function xCall<T>(
  path: string,
  bearer: string,
  query: Record<string, string | number | undefined>,
  ctx?: Pick<FetchContext, 'onApiCall' | 'signal'>,
): Promise<T> {
  return fetchJson<T>(`${API}/${path}`, {
    platform: PLATFORM,
    query,
    headers: { authorization: `Bearer ${bearer}` },
    onApiCall: ctx?.onApiCall,
    signal: ctx?.signal,
    classifyRetryable: classifyXError,
    extractMessage: xErrorMessage,
    retryAfterFromHeaders: xRetryAfter,
  });
}

/* ------------------------------------------------------------- profiles */

interface ResolvedUser {
  profile: AdapterProfile;
  audience: NormalizedAudience;
}

function readUser(node: unknown, handle: string): ResolvedUser {
  const rec = asRecord(node);
  const id = asString(rec?.id);
  const username = asString(rec?.username) ?? handle;
  if (!id) {
    throw new AdapterError(
      `X returned no user for "${handle}". The account may be suspended, deactivated or renamed.`,
      { platform: PLATFORM, retryable: false },
    );
  }

  const metrics = asRecord(rec?.public_metrics);
  const followers = asCount(metrics?.followers_count);

  return {
    profile: {
      externalId: id,
      handle: username,
      displayName: asString(rec?.name) ?? username,
      // The default profile_image_url is the 48px "_normal" variant; the
      // unsuffixed URL is the full-size original and is what the UI wants.
      avatarUrl: asString(rec?.profile_image_url)?.replace(/_normal(\.\w+)$/, '$1') ?? null,
      profileUrl: `https://x.com/${username}`,
      followers,
      meta: { verifiedType: asString(rec?.verified_type) ?? null },
    },
    audience: {
      day: toDayString(new Date()),
      followers,
      following: asCount(metrics?.following_count),
      extra: {
        tweetCount: asCount(metrics?.tweet_count),
        listedCount: asCount(metrics?.listed_count),
      },
    },
  };
}

async function resolveUser(
  handleOrId: string,
  bearer: string,
  ctx?: Pick<FetchContext, 'onApiCall' | 'signal'>,
): Promise<ResolvedUser> {
  // Numeric ids are looked up directly: it is one fewer round trip and immune
  // to a handle change, which on X is self-serve and common.
  const path = /^\d{5,}$/.test(handleOrId)
    ? `users/${handleOrId}`
    : `users/by/username/${encodeURIComponent(handleOrId)}`;
  const body = await xCall<unknown>(path, bearer, { 'user.fields': USER_FIELDS }, ctx);
  const rec = asRecord(body);
  const errors = asArray(rec?.errors);
  if (!asRecord(rec?.data) && errors.length > 0) {
    const detail = asString(asRecord(errors[0])?.detail) ?? 'not found';
    throw new AdapterError(`X could not resolve "${handleOrId}": ${detail}`, {
      platform: PLATFORM, retryable: false,
    });
  }
  return readUser(rec?.data, handleOrId);
}

/* -------------------------------------------------------------- tweets */

interface MediaInfo {
  type: string;
  durationSec: number | null;
  previewUrl: string | null;
  url: string | null;
}

/** media_key -> media, from the includes block of a timeline response. */
function indexMedia(includes: unknown): Map<string, MediaInfo> {
  const out = new Map<string, MediaInfo>();
  for (const raw of asArray(asRecord(includes)?.media)) {
    const rec = asRecord(raw);
    const key = asString(rec?.media_key);
    if (!key) continue;
    const durationMs = asCount(rec?.duration_ms);
    out.set(key, {
      type: asString(rec?.type) ?? 'unknown',
      durationSec: durationMs > 0 ? Math.round(durationMs / 1000) : null,
      previewUrl: asString(rec?.preview_image_url) ?? null,
      url: asString(rec?.url) ?? null,
    });
  }
  return out;
}

/**
 * Entities carry the authoritative URLs. `expanded_url` is the real destination
 * behind the t.co wrapper, which is the only version worth storing — a table of
 * t.co links answers no question anybody has.
 */
function readEntityUrls(entities: unknown): { urls: string[]; hasLink: boolean } {
  const urls: string[] = [];
  for (const raw of asArray(asRecord(entities)?.urls)) {
    const rec = asRecord(raw);
    const expanded = asString(rec?.expanded_url) ?? asString(rec?.unwound_url);
    if (!expanded) continue;
    // Quote tweets and attached media appear in entities.urls as self-links
    // back to x.com. They are not outbound links and would pollute the
    // posted-URL leaderboard with our own domain.
    if (/^https?:\/\/(www\.)?(twitter|x)\.com\//i.test(expanded)) continue;
    urls.push(expanded);
  }
  return { urls, hasLink: urls.length > 0 };
}

function readTweet(raw: Record<string, unknown>, media: Map<string, MediaInfo>): NormalizedPost | undefined {
  const externalId = asString(raw.id);
  const postedAt = asDate(raw.created_at);
  if (!externalId || !postedAt) return undefined;

  // note_tweet holds the full body of a long-form post; `text` is truncated for
  // those. Preferring it means keyword rules see the whole thing.
  const noteText = asString(asRecord(raw.note_tweet)?.text);
  const text = noteText ?? asString(raw.text) ?? '';

  const metrics = asRecord(raw.public_metrics);
  const entities = asRecord(raw.entities) ?? asRecord(asRecord(raw.note_tweet)?.entities);
  const { urls, hasLink } = readEntityUrls(entities);

  const mediaKeys = asArray(asRecord(raw.attachments)?.media_keys)
    .map((k) => asString(k))
    .filter((k): k is string => Boolean(k));
  const attached = mediaKeys.map((k) => media.get(k)).filter((m): m is MediaInfo => m !== undefined);
  const video = attached.find((m) => m.type === 'video' || m.type === 'animated_gif');

  const referenced = asArray(raw.referenced_tweets)
    .map((r) => asString(asRecord(r)?.type))
    .filter((t): t is string => Boolean(t));
  const isRepost = referenced.includes('retweeted');
  const isQuote = referenced.includes('quoted');

  // Hashtags and mentions come from entities where X gives them, because X has
  // already done the unicode segmentation. The regex extractors are the
  // fallback for a payload that arrived without entities.
  const entityTags = asArray(entities?.hashtags)
    .map((h) => asString(asRecord(h)?.tag))
    .filter((t): t is string => Boolean(t))
    .map((t) => t.toLowerCase());
  const entityMentions = asArray(entities?.mentions)
    .map((m) => asString(asRecord(m)?.username))
    .filter((m): m is string => Boolean(m))
    .map((m) => m.toLowerCase());

  return {
    externalId,
    postedAt,
    type: classifyPostType({
      platform: PLATFORM,
      isRepost,
      hasVideo: Boolean(video),
      hasImage: attached.some((m) => m.type === 'photo'),
      hasLink,
      mediaCount: attached.length,
      durationSec: video?.durationSec ?? null,
      nativeType: isQuote && !isRepost ? 'quote' : null,
    }),
    text: text || null,
    // The canonical permalink needs the author handle, which the caller knows
    // and this function does not; it is filled in by the caller.
    permalink: null,
    mediaUrl: video?.url ?? attached[0]?.url ?? null,
    thumbnailUrl: video?.previewUrl ?? attached[0]?.previewUrl ?? attached[0]?.url ?? null,
    durationSec: video?.durationSec ?? null,
    language: asString(raw.lang) ?? null,
    hashtags: entityTags.length > 0 ? Array.from(new Set(entityTags)) : extractHashtags(text),
    mentions: entityMentions.length > 0 ? Array.from(new Set(entityMentions)) : extractMentions(text),
    urls: urls.length > 0 ? Array.from(new Set(urls)) : extractUrls(text),
    applause: asCount(metrics?.like_count),
    conversation: asCount(metrics?.reply_count),
    amplification: asCount(metrics?.retweet_count) + asCount(metrics?.quote_count),
    saves: asCount(metrics?.bookmark_count),
    // Only ever non-zero on your own posts. See the file header.
    views: asCount(metrics?.impression_count),
    raw: {
      retweetCount: asCount(metrics?.retweet_count),
      quoteCount: asCount(metrics?.quote_count),
      impressionCount: asCount(metrics?.impression_count),
      referencedTypes: referenced,
      mediaTypes: attached.map((m) => m.type),
    },
  };
}

interface TimelineResult {
  posts: NormalizedPost[];
  hasMore: boolean;
  newestId: string | null;
}

/**
 * Walk /2/users/{id}/tweets newest-first.
 *
 * since_id from the previous run is the money-saving move: X counts every tweet
 * it returns against the monthly cap, so re-reading a month of history nightly
 * would exhaust a Basic plan in a week. The tradeoff is that engagement counts
 * on older tweets stop updating, which is why the runner also schedules
 * occasional full-window refreshes rather than always trusting the cursor.
 */
async function fetchTimeline(
  userId: string,
  username: string,
  bearer: string,
  ctx: FetchContext,
  sinceId: string | undefined,
): Promise<TimelineResult> {
  const posts: NormalizedPost[] = [];
  let paginationToken: string | undefined;
  let pages = 0;
  let hasMore = false;
  let newestId: string | null = null;

  while (pages < MAX_PAGES && posts.length < ctx.limit) {
    pages++;
    const remaining = ctx.limit - posts.length;
    const body = await xCall<unknown>(`users/${userId}/tweets`, bearer, {
      max_results: Math.max(5, Math.min(TIMELINE_PAGE_SIZE, remaining)),
      'tweet.fields': TWEET_FIELDS,
      expansions: EXPANSIONS,
      'media.fields': MEDIA_FIELDS,
      // Retweets cost quota and are not this account's own output.
      exclude: 'retweets',
      // start_time and since_id are mutually exclusive on this endpoint; the
      // cursor wins when we have one because it is strictly cheaper.
      since_id: sinceId,
      start_time: sinceId ? undefined : ctx.since.toISOString(),
      end_time: ctx.until.toISOString(),
      pagination_token: paginationToken,
    }, ctx);

    const rec = asRecord(body);
    const media = indexMedia(rec?.includes);
    const items = asArray(rec?.data);

    for (const item of items) {
      const tweet = asRecord(item);
      if (!tweet) continue;
      const post = readTweet(tweet, media);
      if (!post) continue;
      if (post.postedAt < ctx.since || post.postedAt > ctx.until) continue;
      post.permalink = `https://x.com/${username}/status/${post.externalId}`;
      if (!newestId || post.externalId.length > newestId.length
        || (post.externalId.length === newestId.length && post.externalId > newestId)) {
        newestId = post.externalId;
      }
      posts.push(post);
    }

    const meta = asRecord(rec?.meta);
    paginationToken = asString(meta?.next_token);
    if (!paginationToken) break;
    if (posts.length >= ctx.limit) { hasMore = true; break; }
    if (pages >= MAX_PAGES) hasMore = true;
  }

  return { posts, hasMore, newestId };
}

/* ------------------------------------------------------------- adapter */

export const twitterAdapter: ChannelAdapter = {
  platform: PLATFORM,
  displayName: 'X / Twitter',
  accessNotes:
    'Paid API access only. X API v2 with an app-only Bearer token; there is no free read tier. '
    + 'The legacy Basic subscription was roughly $200 per month for on the order of 10,000 posts read '
    + 'per month across the whole project, and Pro roughly $5,000 per month for around 1,000,000. In '
    + 'February 2026 X moved new developers, and then existing Basic subscribers, onto metered '
    + 'credits at a reported rate near half a cent per post read, capped around two million reads a '
    + 'month before an Enterprise contract is required. Confirm current pricing in the developer '
    + 'portal before budgeting: X has revised it repeatedly with little notice. '
    + 'The practical consequence either way is that a ten-account landscape posting thirty times a '
    + 'day is about 9,000 posts a month before any engagement refresh, so this adapter reads '
    + 'incrementally with since_id and never pages speculatively. '
    + 'impression_count, which we map to views, is ONLY populated for posts from the authenticating '
    + 'account. For every competitor it is absent and stored as 0, so view-based rates are undefined '
    + 'on competitor X channels. Likes, replies, retweets, quotes and bookmarks are public and '
    + 'available for any account this token can read.',
  credentialFields: [
    { key: 'bearerToken', label: 'X API v2 Bearer token', secret: true, required: true,
      help: 'developer.x.com, your Project, Keys and tokens, Bearer Token. Requires a Basic plan or higher.' },
  ],
  // The v2 user-timeline limit on Basic is 5 requests per 15 minutes per app.
  // The monthly tweet cap is the binding constraint in practice, but the
  // scheduler paces on requests because that is what it can count.
  rateLimit: { callsPerWindow: 5, windowSeconds: 900 },
  worksUnauthenticated: false,

  /**
   * Accepts an @handle, a bare handle, a numeric user id, and x.com or
   * twitter.com profile and status URLs.
   */
  parseHandle(input: string): string {
    const trimmed = input.trim();
    if (!trimmed) throw new AdapterError('Empty X handle', { platform: PLATFORM, retryable: false });
    if (/^\d{5,}$/.test(trimmed)) return trimmed;

    let candidate = trimmed;
    if (/^https?:\/\//i.test(trimmed)) {
      let url: URL;
      try {
        url = new URL(trimmed);
      } catch {
        throw new AdapterError(`Unparseable X URL: ${input}`, { platform: PLATFORM, retryable: false });
      }
      if (!/(^|\.)(x\.com|twitter\.com)$/i.test(url.hostname)) {
        throw new AdapterError(`Not an X URL: ${input}`, { platform: PLATFORM, retryable: false });
      }
      const segments = url.pathname.split('/').filter(Boolean);
      const found = segments[0] === 'i' ? segments[2] : segments[0];
      if (!found) throw new AdapterError(`No account in URL: ${input}`, { platform: PLATFORM, retryable: false });
      candidate = found;
    }

    candidate = candidate.replace(/^@/, '');
    // X handles are 1-15 characters of letters, digits and underscore.
    if (!/^[A-Za-z0-9_]{1,15}$/.test(candidate)) {
      throw new AdapterError(`Invalid X handle: ${input}`, { platform: PLATFORM, retryable: false });
    }
    return candidate;
  },

  async resolveProfile(handle: string, credentials: Record<string, string>): Promise<AdapterProfile> {
    const resolved = await resolveUser(handle, requireBearer(credentials));
    return resolved.profile;
  },

  async fetch(ctx: FetchContext): Promise<FetchResult> {
    const bearer = requireBearer(ctx.credentials);
    const warnings: string[] = [];

    const { profile, audience } = await resolveUser(ctx.externalId ?? ctx.handle, bearer, ctx);

    // Only trust a stored since_id that belongs to this account. A channel that
    // was re-pointed at a different handle would otherwise silently return
    // nothing forever, because tweet ids are globally ordered by time.
    const cursorUserId = typeof ctx.cursor.userId === 'string' ? ctx.cursor.userId : undefined;
    const storedSinceId = typeof ctx.cursor.newestTweetId === 'string' ? ctx.cursor.newestTweetId : undefined;
    const sinceId = cursorUserId === profile.externalId ? storedSinceId : undefined;

    const timeline = await fetchTimeline(profile.externalId, profile.handle, bearer, ctx, sinceId);

    const ownAccount = ctx.credentials.selfUserId?.trim() === profile.externalId;
    if (!ownAccount && timeline.posts.some((p) => p.views > 0)) {
      warnings.push('impression_count was returned for an account not marked as owned; treating it as views.');
    }
    if (!ownAccount) {
      warnings.push('Views are unavailable for accounts you do not authenticate as, and are stored as 0.');
    }

    return {
      posts: timeline.posts,
      audience: [audience],
      profile,
      cursor: {
        userId: profile.externalId,
        // Only advance the high-water mark when we actually saw something newer;
        // an empty run must not reset it.
        newestTweetId: timeline.newestId ?? storedSinceId ?? null,
        lastRunAt: new Date().toISOString(),
      },
      hasMore: timeline.hasMore,
      warnings: warnings.length > 0 ? warnings : undefined,
    };
  },

  /**
   * One user lookup against an account guaranteed to exist. This distinguishes
   * the three real failure modes: bad token (401), tier does not include reads
   * (403), and network or project misconfiguration.
   */
  async healthCheck(credentials: Record<string, string>): Promise<{ ok: boolean; message: string }> {
    try {
      const bearer = requireBearer(credentials);
      await xCall<unknown>('users/by/username/X', bearer, { 'user.fields': 'id' });
      return { ok: true, message: 'Bearer token accepted by the X API v2.' };
    } catch (err) {
      if (err instanceof AdapterError) {
        if (err.opts.status === 403) {
          return { ok: false, message: `Token valid but the plan does not include this endpoint: ${err.message}` };
        }
        return { ok: false, message: err.message };
      }
      return { ok: false, message: err instanceof Error ? err.message : 'Unknown error' };
    }
  },
};

export default twitterAdapter;
