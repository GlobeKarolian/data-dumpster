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
 *  - impression_count -> views. Verified live on 17 Aug 2026: X now returns
 *    impression_count through app-only authentication for accounts we do not
 *    authenticate as, so views are part of the public surface. The historical
 *    owner-only limitation this header used to describe is gone, and it was
 *    the reason bearer collection was once restricted to owned channels.
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
import { DATASETS } from '@/lib/vendors/brightdata';
import {
  clearBrightDataReceipt,
  pendingBrightDataStage,
  runBrightDataStage,
} from './brightdata-receipt';

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

/* ------------------------------------------------------- source routing */

export type TwitterSourceId = 'x-api-v2' | 'ensembledata' | 'brightdata';

export interface TwitterSourceAvailability {
  owned: boolean;
  hasBearer: boolean;
  hasEnsemble: boolean;
  hasBrightData: boolean;
}

/**
 * The official API leads for every X channel when a Bearer token is configured.
 *
 * This used to be ownership-gated, and the old rationale was the metric basis:
 * when impression_count was returned only for the authenticating user, letting
 * a Bearer token serve pooled collection could have mixed owned-native values
 * into public rows. That premise is gone, verified live on 17 Aug 2026:
 * app-only authentication returns impression_count for accounts we do not own,
 * which is by definition the public surface any API consumer sees. An app-only
 * Bearer is a deployment credential like a vendor key, not an organization's
 * user-context token; those remain excluded from pooled collection.
 *
 * The API is also the only X source that certifies a window: a chronological
 * timeline with since_id and pagination to the boundary. Bright Data could not
 * certify on a live exact-window test and EnsembleData returns a
 * Twitter-selected Highlights feed. The vendors stay as fallback so a vendor
 * outage or an API failure degrades to uncertified-but-useful rather than to
 * nothing, and a pending paid Bright Data receipt still resumes first.
 */
export function twitterSourceOrder(
  availability: TwitterSourceAvailability,
): TwitterSourceId[] {
  const vendors: TwitterSourceId[] = availability.hasBrightData
    ? ['brightdata']
    : availability.hasEnsemble
      ? ['ensembledata']
      : [];

  if (availability.hasBearer) {
    return ['x-api-v2', ...vendors];
  }
  return vendors;
}

const SOURCE_LABEL: Record<TwitterSourceId, string> = {
  'x-api-v2': 'X API v2',
  ensembledata: 'EnsembleData',
  brightdata: 'Bright Data',
};

function conciseError(err: unknown): string {
  const raw = err instanceof Error ? err.message : String(err);
  const oneLine = raw.replace(/\s+/g, ' ').trim() || 'unknown error';
  return oneLine.length <= 180 ? oneLine : oneLine.slice(0, 177) + '...';
}

async function fetchViaXApi(ctx: FetchContext, bearer: string): Promise<FetchResult> {
  const warnings: string[] = [];
  const { profile, audience } = await resolveUser(ctx.externalId ?? ctx.handle, bearer, ctx);

  // Only trust a stored since_id that belongs to this account. A channel that
  // was re-pointed at a different handle would otherwise silently return
  // nothing forever, because tweet ids are globally ordered by time.
  const cursorUserId = typeof ctx.cursor.userId === 'string' ? ctx.cursor.userId : undefined;
  const storedSinceId = typeof ctx.cursor.newestTweetId === 'string'
    ? ctx.cursor.newestTweetId
    : undefined;
  const sinceId = cursorUserId === profile.externalId ? storedSinceId : undefined;
  const timeline = await fetchTimeline(profile.externalId, profile.handle, bearer, ctx, sinceId);

  return {
    posts: timeline.posts,
    audience: [audience],
    profile,
    cursor: {
      source: 'x-api-v2',
      userId: profile.externalId,
      // A capped response has unseen rows below it and no persisted pagination
      // token. Advancing since_id would skip that gap forever, so only a
      // terminal timeline response may move the high-water mark.
      newestTweetId: timeline.hasMore
        ? storedSinceId ?? null
        : timeline.newestId ?? storedSinceId ?? null,
      lastRunAt: new Date().toISOString(),
    },
    ...(timeline.hasMore
      ? {
          // The X pagination token is not persisted. Advancing since_id and
          // claiming a continuation would skip older rows in this window.
          hasMore: false as const,
          exhaustive: false as const,
          incompleteReason: 'X API v2 reached the per-run post or page limit without a persisted pagination token. Add window-bound token persistence before certifying this requested window.',
        }
      : { hasMore: false as const, exhaustive: true as const }),
    warnings: warnings.length > 0 ? warnings : undefined,
  };
}

async function fetchViaEnsemble(
  ctx: FetchContext,
  token: string,
): Promise<FetchResult> {
  const { fetchProfile, fetchPosts } = await import('./twitter-ensemble');
  const { profile, audience } = await fetchProfile(
    ctx.handle,
    token,
    ctx.onApiCall,
    ctx.signal,
  );
  const result = await fetchPosts(profile.externalId, profile.handle, token, {
    since: ctx.since,
    until: ctx.until,
    limit: ctx.limit,
    onApiCall: ctx.onApiCall,
    signal: ctx.signal,
  });

  return {
    posts: result.posts,
    audience: audience ? [audience] : [],
    profile,
    cursor: {
      source: 'ensembledata',
      userId: profile.externalId,
      lastRunAt: new Date().toISOString(),
    },
    hasMore: false,
    /*
     * This source can never certify a window, so it never claims to.
     *
     * EnsembleData's /twitter/user/tweets returns whatever Twitter selects for
     * the profile, which for most accounts is the Highlights tab rather than a
     * chronological timeline. Checked live against @BostonGlobe: 100 rows came
     * back, every one parsed cleanly with full engagement, and their dates were
     * 2015, 2018, 2019, 2021 and 2024. The window filter correctly discarded
     * all of them.
     *
     * The adapter already warned about exactly this. What it did not do was set
     * exhaustive, so the run was recorded as `succeeded` and the coverage panel
     * printed a green "Complete" beside a post count of zero. Twenty-two
     * channels read as fully collected while holding no posts at all, which is
     * a worse failure than an error: an error gets investigated.
     *
     * Marking it incomplete records a terminal source limitation: coverage
     * stays honest without repeatedly buying the same selected feed.
     */
    exhaustive: false,
    incompleteReason: result.posts.length === 0
      ? 'X returned only its profile highlights for @' + ctx.handle + ', which are chosen by '
        + 'Twitter and are not chronological. None fell inside this window, so the account\'s '
        + 'recent posting is unmeasured rather than absent.'
      : 'X posts come from Twitter\'s own selected set rather than a chronological timeline, '
        + 'so this window cannot be certified complete.',
    warnings: result.warnings,
  };
}

async function fetchViaBrightData(
  ctx: FetchContext,
  apiKey: string,
): Promise<FetchResult> {
  const { fetchProfilePosts } = await import('./twitter-brightdata');
  const stage = await runBrightDataStage(ctx, {
    platform: PLATFORM,
    stage: 'twitter-posts',
    datasetId: DATASETS.twitterPosts,
  }, async (resumeSnapshotId) => await fetchProfilePosts(ctx.handle, apiKey, {
    since: ctx.since,
    until: ctx.until,
    limit: ctx.limit,
    onApiCall: ctx.onApiCall,
    signal: ctx.signal,
    resumeSnapshotId,
    fallbackExternalId: ctx.externalId,
  }));
  if (stage.kind === 'continuation') return stage.result;
  const result = stage.value;
  const profile = result.profile ?? (ctx.externalId?.trim()
    ? {
        externalId: ctx.externalId.trim(),
        handle: ctx.handle.replace(/^@/, ''),
        profileUrl: 'https://x.com/' + ctx.handle.replace(/^@/, ''),
        meta: { source: 'brightdata', identitySource: 'stored-verified-profile' },
      }
    : undefined);
  if (!profile) {
    throw new AdapterError(
      'Bright Data returned no readable X profile for @' + ctx.handle
      + (result.warnings[0] ? ': ' + result.warnings[0] : '.'),
      { platform: PLATFORM, retryable: false },
    );
  }
  return {
    posts: result.posts,
    audience: result.audience ? [result.audience] : [],
    profile,
    cursor: {
      source: 'brightdata',
      ...clearBrightDataReceipt(),
      lastRunAt: new Date().toISOString(),
    },
    ...(result.exhaustive
      ? { hasMore: false as const, exhaustive: true as const }
      : {
          hasMore: false as const,
          exhaustive: false as const,
          incompleteReason: result.incompleteReason
            ?? 'Bright Data did not certify the requested X window and exposed no continuation cursor.',
        }),
    warnings: [...result.warnings, ...stage.warnings],
  };
}

interface ConfiguredTwitterSource {
  id: TwitterSourceId;
  run: () => Promise<FetchResult>;
}

interface TwitterSourceFailure {
  id: TwitterSourceId;
  detail: string;
  error: unknown;
}

async function fetchWithFailover(
  ctx: FetchContext,
  sources: ConfiguredTwitterSource[],
): Promise<FetchResult> {
  const failures: TwitterSourceFailure[] = [];

  for (const source of sources) {
    try {
      const result = await source.run();
      const fallbackWarnings = failures.map((failure) =>
        'X source ' + SOURCE_LABEL[failure.id] + ' failed; '
        + SOURCE_LABEL[source.id] + ' was used instead: ' + failure.detail);
      const warnings = [...fallbackWarnings, ...(result.warnings ?? [])];
      return {
        ...result,
        warnings: warnings.length > 0 ? warnings : undefined,
      };
    } catch (err) {
      // Caller cancellation is terminal. Trying the next paid source would
      // spend money after the ingest run was explicitly stopped.
      if (ctx.signal?.aborted) throw err;
      failures.push({ id: source.id, detail: conciseError(err), error: err });
      // A failed paid Bright Data stage is terminal for this run. Falling
      // through to another vendor would both obscure the paid-stage failure
      // and risk losing a receipt that must be resumed exactly.
      if (source.id === 'brightdata') break;
    }
  }

  const retryable = failures.some((failure) =>
    failure.error instanceof AdapterError && failure.error.opts.retryable === true);
  const detail = failures
    .map((failure) => SOURCE_LABEL[failure.id] + ': ' + failure.detail)
    .join(' | ');
  throw new AdapterError(
    'Every configured X source failed. ' + detail,
    { platform: PLATFORM, retryable },
  );
}

/* ------------------------------------------------------------- adapter */

export const twitterAdapter: ChannelAdapter = {
  platform: PLATFORM,
  displayName: 'X / Twitter',
  accessNotes:
    'Pooled public collection uses Bright Data exclusively when it is configured. EnsembleData is '
    + 'used for collection only when Bright Data is not configured, and remains the synchronous '
    + 'identity source for onboarding until a receipt-preserving Bright Data profile mapper exists. '
    + 'A failed or cancelled paid Bright Data stage is never retried through EnsembleData. '
    + 'EnsembleData returns followers and public engagement, but its X post endpoint is '
    + 'Twitter-selected rather than chronological, so each run carries an explicit coverage warning. An X API v2 Bearer '
    + 'token remains the preferred owned-account path because it supports incremental timelines. '
    + 'X only returns impression_count for the authenticating account; competitor views are missing '
    + 'and stay 0. Likes, replies, retweets, quotes and bookmarks are public where the source exposes '
    + 'them.',
  credentialFields: [
    { key: 'bearerToken', label: 'X API v2 Bearer token', secret: true, required: false,
      help: 'Optional owned-account path. From developer.x.com, your Project, Keys and tokens.' },
    { key: 'ensembleDataToken', label: 'EnsembleData token', secret: true, required: false,
      help: 'Required for public profile onboarding; used for collection only when Bright Data is not configured.' },
    { key: 'brightDataApiKey', label: 'Bright Data API key', secret: true, required: false,
      help: 'Primary pooled public collection source for existing verified channels.' },
  ],
  // Public vendors bill by
  // daily units rather than publishing a narrow per-minute endpoint quota.
  // Its existing adapters use this conservative pacing budget as well.
  rateLimit: { callsPerWindow: 100, windowSeconds: 60 },
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
    const ensembleToken = credentials.ensembleDataToken?.trim() || '';
    const brightDataKey = credentials.brightDataApiKey?.trim() || '';
    // Callers explicitly decide whether this identity lookup may use an owned
    // credential. Public pooled routes pass no Bearer token and must not be
    // overridden by a deployment environment fallback.
    const bearer = credentials.bearerToken?.trim() || '';
    let ensembleFailure: unknown;

    if (ensembleToken) {
      try {
        const { fetchProfile } = await import('./twitter-ensemble');
        const result = await fetchProfile(handle, ensembleToken);
        return result.profile;
      } catch (err) {
        ensembleFailure = err;
        if (!bearer && !brightDataKey) throw err;
      }
    }

    if (bearer) {
      try {
        const resolved = await resolveUser(handle, bearer);
        return resolved.profile;
      } catch (err) {
        if (!ensembleFailure) throw err;
        const retryable = [ensembleFailure, err].some((failure) =>
          failure instanceof AdapterError && failure.opts.retryable === true);
        throw new AdapterError(
          'X profile lookup failed. EnsembleData: ' + conciseError(ensembleFailure)
          + ' | X API v2: ' + conciseError(err),
          { platform: PLATFORM, retryable },
        );
      }
    }

    if (brightDataKey) {
      const reason = 'Bright Data can expose a real X `user_id`/`profile_id` on completed post '
        + 'rows, but it has no separate receipt-preserving profile lookup. Triggering that paid '
        + 'asynchronous posts crawl during verification could lose its snapshot receipt and buy the '
        + 'same work again during collection. Configure EnsembleData for safe X onboarding; Bright '
        + 'Data is the primary collection source for an existing verified channel.';
      if (ensembleFailure !== undefined) {
        throw new AdapterError(
          'X profile lookup through EnsembleData failed: ' + conciseError(ensembleFailure) + ' ' + reason,
          {
            platform: PLATFORM,
            retryable: ensembleFailure instanceof AdapterError
              && ensembleFailure.opts.retryable === true,
          },
        );
      }
      throw new AdapterError(reason, { platform: PLATFORM, retryable: false });
    }

    throw new AdapterError(
      'Adding or verifying an X channel requires an EnsembleData token or an explicitly supplied '
      + 'X API v2 Bearer token. Bright Data is the primary collection source for channels that already '
      + 'have a verified platform id.',
      { platform: PLATFORM, retryable: false },
    );
  },

  async fetch(ctx: FetchContext): Promise<FetchResult> {
    // Fetch credentials are supplied by the runner's explicit source policy;
    // the adapter still never reaches around it to the environment. The
    // deployment Bearer arrives here through publicSourceCredentials because
    // app-only reads return the public surface, impression_count included
    // (verified live 17 Aug 2026), so using it for pooled channels no longer
    // changes the metric basis. What keeps org user-context tokens out of
    // pooled rows is the runner's allowlist: they are never supplied, so there
    // is nothing here to discard.
    const explicitlyOwned = ctx.cursor.__isOwned === true;
    const bearer = ctx.credentials.bearerToken?.trim() || '';
    const ensembleToken = ctx.credentials.ensembleDataToken?.trim() || '';
    const brightDataKey = ctx.credentials.brightDataApiKey?.trim() || '';
    const pendingStage = pendingBrightDataStage(ctx.cursor, PLATFORM);
    if (pendingStage !== undefined && pendingStage !== 'twitter-posts') {
      throw new AdapterError(
        'X has a Bright Data receipt for unknown stage "' + pendingStage
          + '". Reconcile the receipt before starting another paid snapshot.',
        { platform: PLATFORM, retryable: false },
      );
    }
    if (pendingStage !== undefined && !brightDataKey) {
      throw new AdapterError(
        'X has a paid Bright Data snapshot waiting to resume, but the Bright Data API key is '
          + 'unavailable. Restore the key before collecting this account through another source.',
        { platform: PLATFORM, retryable: false },
      );
    }
    const order: TwitterSourceId[] = pendingStage !== undefined
      ? ['brightdata']
      : twitterSourceOrder({
          owned: explicitlyOwned,
          hasBearer: Boolean(bearer),
          hasEnsemble: Boolean(ensembleToken),
          hasBrightData: Boolean(brightDataKey),
        });

    if (order.length === 0) {
      throw new AdapterError(
        explicitlyOwned
          ? 'Owned X collection requires an X API v2 Bearer token, an EnsembleData token, or a Bright Data API key.'
          : 'Public X collection requires an X API v2 Bearer token, a Bright Data API key or an '
            + 'EnsembleData token.',
        { platform: PLATFORM, retryable: false },
      );
    }

    const sources = order.map((id): ConfiguredTwitterSource => {
      if (id === 'x-api-v2') {
        return { id, run: () => fetchViaXApi(ctx, bearer) };
      }
      if (id === 'ensembledata') {
        return { id, run: () => fetchViaEnsemble(ctx, ensembleToken) };
      }
      return { id, run: () => fetchViaBrightData(ctx, brightDataKey) };
    });
    return await fetchWithFailover(ctx, sources);
  },

  /**
   * One user lookup against an account guaranteed to exist. This distinguishes
   * the three real failure modes: bad token (401), tier does not include reads
   * (403), and network or project misconfiguration.
   */
  async healthCheck(credentials: Record<string, string>): Promise<{ ok: boolean; message: string }> {
    try {
      const ensembleToken = credentials.ensembleDataToken?.trim()
        || process.env.ENSEMBLEDATA_TOKEN?.trim()
        || '';
      const bearer = credentials.bearerToken?.trim()
        || process.env.TWITTER_BEARER_TOKEN?.trim()
        || '';
      let ensembleFailure: unknown;

      if (ensembleToken) {
        try {
          const { fetchProfile } = await import('./twitter-ensemble');
          await fetchProfile('X', ensembleToken);
          return { ok: true, message: 'EnsembleData returned a public X profile.' };
        } catch (err) {
          ensembleFailure = err;
          if (!bearer) throw err;
        }
      }

      if (bearer) {
        try {
          await xCall<unknown>('users/by/username/X', bearer, { 'user.fields': 'id' });
          return {
            ok: true,
            message: ensembleFailure
              ? 'EnsembleData failed, but the X API v2 Bearer token was accepted.'
              : 'Bearer token accepted by the X API v2.',
          };
        } catch (err) {
          if (!ensembleFailure) throw err;
          throw new AdapterError(
            'X health check failed. EnsembleData: ' + conciseError(ensembleFailure)
            + ' | X API v2: ' + conciseError(err),
            { platform: PLATFORM, retryable: false },
          );
        }
      }

      requireBearer(credentials);
      return { ok: false, message: 'No X credential configured.' };
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
