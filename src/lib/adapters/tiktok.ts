/**
 * TikTok — Display API v2, owned accounts only.
 *
 * WHAT THIS CAN AND CANNOT DO, UP FRONT:
 *
 *  - **Owned accounts work.** The Display API (/v2/user/info/ and
 *    /v2/video/list/) returns follower count, video list, and per-video views,
 *    likes, comments and shares for the account that granted the OAuth token.
 *    That is a genuine, complete owned-channel integration.
 *
 *  - **Competitor accounts do not.** There is no public read endpoint. The only
 *    sanctioned route is the Research API (/v2/research/video/query/), which
 *    requires a written application, is reviewed case by case, is restricted to
 *    approved academic and non-profit researchers in the US and Europe, forbids
 *    commercial use of the data, and carries its own quota and re-application
 *    cycle. A newsroom product cannot depend on it, and if a newsroom did get
 *    approved, the terms would not let this tool use the results the way the
 *    rest of the product does. Treat TikTok competitors as a blind spot and be
 *    explicit about it in every chart.
 *
 *  - **Scraping is not an option we are offering.** Vendors sell TikTok
 *    competitor data that is obtained by scraping. It violates TikTok's terms,
 *    it breaks without warning, and it is not a defensible foundation for a
 *    newsroom's own measurement. If the Globe wants competitor TikTok numbers,
 *    the honest answer is a paid vendor with a contract and an indemnity, not a
 *    line of code in this file.
 *
 * TRANSPORT QUIRK: TikTok returns HTTP 200 for application errors and puts the
 * real outcome in an `error` object whose `code` is the string "ok" on success.
 * Every response therefore has to be inspected, not just the status.
 *
 * TOKEN QUIRK: Display API access tokens live 24 hours. The refresh token lives
 * 365 days. A nightly ingest will hit an expired access token essentially every
 * run, so refresh is implemented here rather than left to an operator.
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
import { asArray, asCount, asRecord, asString, fetchJson } from './util/request';
import { classifyPostType, extractHashtags, extractMentions, extractUrls, toDayString } from './util/normalize';
import { DATASETS } from '@/lib/vendors/brightdata';
import {
  clearBrightDataReceipt,
  pendingBrightDataStage,
  runBrightDataStage,
} from './brightdata-receipt';

const PLATFORM: Platform = 'tiktok';
const API = 'https://open.tiktokapis.com/v2';

/** video/list caps max_count at 20. */
const VIDEO_PAGE_SIZE = 20;
/** Hard stop on paging: 20 pages is 400 videos, more than any newsroom posts in a window. */
const MAX_PAGES = 20;

const USER_FIELDS = [
  'open_id', 'union_id', 'avatar_url', 'display_name', 'username', 'bio_description',
  'profile_deep_link', 'is_verified', 'follower_count', 'following_count',
  'likes_count', 'video_count',
].join(',');

const VIDEO_FIELDS = [
  'id', 'create_time', 'cover_image_url', 'share_url', 'video_description',
  'duration', 'title', 'like_count', 'comment_count', 'share_count', 'view_count',
].join(',');

/* ------------------------------------------------------------- transport */

/** Error codes that are worth another attempt rather than a failed run. */
const RETRYABLE_CODES = new Set(['rate_limit_exceeded', 'internal_error', 'service_unavailable']);
/** Codes that mean the token needs refreshing before anything else will work. */
const TOKEN_CODES = new Set(['access_token_invalid', 'access_token_expired', 'token_expired', 'unauthorized']);

function tiktokErrorCode(parsed: unknown): string | undefined {
  return asString(asRecord(asRecord(parsed)?.error)?.code);
}

function classifyTikTokError(ctx: { parsed: unknown }): boolean | undefined {
  const code = tiktokErrorCode(ctx.parsed);
  if (!code) return undefined;
  if (RETRYABLE_CODES.has(code)) return true;
  if (TOKEN_CODES.has(code)) return false;
  return undefined;
}

function tiktokMessage(parsed: unknown, body: string): string | undefined {
  const err = asRecord(asRecord(parsed)?.error);
  const code = asString(err?.code);
  const message = asString(err?.message);
  const logId = asString(err?.log_id);
  if (code && code !== 'ok') {
    return `${code}${message ? `: ${message}` : ''}${logId ? ` (log_id ${logId})` : ''}`;
  }
  return body.trim() ? body.slice(0, 300) : undefined;
}

/**
 * TikTok's success envelope is `{data: {...}, error: {code: "ok", ...}}` served
 * with HTTP 200 even when it failed. Anything other than "ok" is turned into a
 * real AdapterError here so the rest of the adapter can pretend the transport
 * behaves like every other one.
 */
function unwrap(body: unknown): Record<string, unknown> {
  const code = tiktokErrorCode(body);
  if (code && code !== 'ok') {
    const err = asRecord(asRecord(body)?.error);
    const message = asString(err?.message) ?? code;
    throw new AdapterError(`TikTok error ${code}: ${message}`, {
      platform: PLATFORM,
      retryable: RETRYABLE_CODES.has(code),
    });
  }
  return asRecord(asRecord(body)?.data) ?? {};
}

interface TikTokAuth {
  accessToken: string;
  /** Set when the token was refreshed during this run so the caller can persist it. */
  refreshedAccessToken?: string;
  refreshedRefreshToken?: string;
  expiresAt?: string;
}

function requireAccessToken(credentials: Record<string, string>): string {
  const token = credentials.accessToken?.trim();
  if (!token) {
    throw new AdapterError(
      'TikTok requires an OAuth access token from the account owner. There is no unauthenticated '
      + 'read path.',
      { platform: PLATFORM, retryable: false },
    );
  }
  return token;
}

/**
 * Exchange a refresh token for a new access token.
 *
 * Called lazily, only after a request has actually failed with a token error.
 * Refreshing pre-emptively on every run would be a wasted call and would rotate
 * the refresh token more often than necessary, and TikTok invalidates the old
 * one immediately.
 */
async function refreshAccessToken(
  credentials: Record<string, string>,
  ctx?: Pick<FetchContext, 'onApiCall' | 'signal'>,
): Promise<TikTokAuth> {
  const clientKey = credentials.clientKey?.trim();
  const clientSecret = credentials.clientSecret?.trim();
  const refreshToken = credentials.refreshToken?.trim();

  if (!clientKey || !clientSecret || !refreshToken) {
    throw new AdapterError(
      'The TikTok access token has expired and no refresh token is configured. Reconnect the account '
      + 'in Settings, Data Sources.',
      { platform: PLATFORM, retryable: false },
    );
  }

  const body = await fetchJson<unknown>(`${API}/oauth/token/`, {
    platform: PLATFORM,
    method: 'POST',
    form: {
      client_key: clientKey,
      client_secret: clientSecret,
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
    },
    onApiCall: ctx?.onApiCall,
    signal: ctx?.signal,
    extractMessage: tiktokMessage,
    retries: 1,
  });

  const rec = asRecord(body) ?? {};
  const accessToken = asString(rec.access_token);
  if (!accessToken) {
    const err = asString(rec.error_description) ?? asString(rec.error) ?? 'no access_token in response';
    throw new AdapterError(`TikTok token refresh failed: ${err}`, { platform: PLATFORM, retryable: false });
  }

  const expiresIn = asCount(rec.expires_in);
  return {
    accessToken,
    refreshedAccessToken: accessToken,
    refreshedRefreshToken: asString(rec.refresh_token) ?? refreshToken,
    expiresAt: expiresIn > 0 ? new Date(Date.now() + expiresIn * 1000).toISOString() : undefined,
  };
}

interface TikTokRequest {
  path: string;
  auth: TikTokAuth;
  query?: Record<string, string | number | undefined>;
  body?: unknown;
  ctx?: Pick<FetchContext, 'onApiCall' | 'signal'>;
}

function rawCall(req: TikTokRequest): Promise<unknown> {
  return fetchJson<unknown>(`${API}/${req.path}`, {
    platform: PLATFORM,
    method: req.body === undefined ? 'GET' : 'POST',
    query: req.query,
    body: req.body,
    headers: { authorization: `Bearer ${req.auth.accessToken}` },
    onApiCall: req.ctx?.onApiCall,
    signal: req.ctx?.signal,
    classifyRetryable: classifyTikTokError,
    extractMessage: tiktokMessage,
  });
}

/**
 * Call the Display API, refreshing the access token once if it has expired.
 *
 * The refreshed token is written back onto the mutable `auth` object so every
 * later call in the same run reuses it, and so the adapter can hand it to the
 * runner for persistence at the end.
 */
async function call(req: TikTokRequest, credentials: Record<string, string>): Promise<Record<string, unknown>> {
  try {
    return unwrap(await rawCall(req));
  } catch (err) {
    const expired = err instanceof AdapterError
      && (err.opts.status === 401 || /access_token_(invalid|expired)|token_expired/i.test(err.message));
    if (!expired) throw err;

    const refreshed = await refreshAccessToken(credentials, req.ctx);
    req.auth.accessToken = refreshed.accessToken;
    req.auth.refreshedAccessToken = refreshed.refreshedAccessToken;
    req.auth.refreshedRefreshToken = refreshed.refreshedRefreshToken;
    req.auth.expiresAt = refreshed.expiresAt;
    return unwrap(await rawCall(req));
  }
}

/* -------------------------------------------------------------- reading */

interface ResolvedTikTokUser {
  profile: AdapterProfile;
  audience: NormalizedAudience;
}

function readUser(data: Record<string, unknown>, handle: string): ResolvedTikTokUser {
  const user = asRecord(data.user) ?? data;
  const openId = asString(user.open_id);
  if (!openId) {
    throw new AdapterError(
      'TikTok returned no open_id. The token is valid but the user.info scope was not granted.',
      { platform: PLATFORM, retryable: false },
    );
  }

  const username = asString(user.username) ?? handle;
  const followers = asCount(user.follower_count);

  return {
    profile: {
      externalId: openId,
      handle: username,
      displayName: asString(user.display_name) ?? username,
      avatarUrl: asString(user.avatar_url) ?? null,
      profileUrl: asString(user.profile_deep_link) ?? `https://www.tiktok.com/@${username}`,
      followers,
      meta: {
        unionId: asString(user.union_id) ?? null,
        isVerified: user.is_verified === true,
      },
    },
    audience: {
      day: toDayString(new Date()),
      followers,
      following: asCount(user.following_count),
      extra: {
        // Lifetime likes across all videos. TikTok's own vanity number, and the
        // only cumulative engagement figure the Display API gives us.
        totalLikes: asCount(user.likes_count),
        videoCount: asCount(user.video_count),
      },
    },
  };
}

function readVideo(raw: Record<string, unknown>, username: string): NormalizedPost | undefined {
  const externalId = asString(raw.id) ?? (typeof raw.id === 'number' ? String(raw.id) : undefined);
  // create_time is unix seconds, not an ISO string, so asDate is no use here.
  const createdSeconds = asCount(raw.create_time);
  if (!externalId || createdSeconds <= 0) return undefined;

  const description = asString(raw.video_description) ?? asString(raw.title) ?? '';
  const durationSec = asCount(raw.duration);

  return {
    externalId,
    postedAt: new Date(createdSeconds * 1000),
    // Everything on TikTok is a video; the only useful distinction the product
    // makes is short-form versus long, which classifyPostType derives from
    // duration. Photo-mode posts report duration 0 and no reliable type flag,
    // so they are still classified as video rather than guessed at.
    type: classifyPostType({ platform: PLATFORM, hasVideo: true, durationSec: durationSec || null }),
    text: description || null,
    permalink: asString(raw.share_url) ?? `https://www.tiktok.com/@${username}/video/${externalId}`,
    mediaUrl: asString(raw.share_url) ?? null,
    thumbnailUrl: asString(raw.cover_image_url) ?? null,
    durationSec: durationSec > 0 ? durationSec : null,
    language: null,
    hashtags: extractHashtags(description),
    mentions: extractMentions(description),
    urls: extractUrls(description),
    applause: asCount(raw.like_count),
    conversation: asCount(raw.comment_count),
    amplification: asCount(raw.share_count),
    // TikTok exposes no save or favourite count on the Display API, to anyone.
    saves: 0,
    views: asCount(raw.view_count),
    raw: {
      coverImageUrl: asString(raw.cover_image_url) ?? null,
      durationSec,
    },
  };
}

/**
 * Walk /v2/video/list/ newest-first.
 *
 * The endpoint has no since/until arguments: the cursor is the create_time of
 * the last item in milliseconds, and paging is strictly backwards through time.
 * The window filter is therefore client-side, and we stop as soon as a whole
 * page predates `since`.
 */
async function fetchVideos(
  ctx: FetchContext,
  auth: TikTokAuth,
  username: string,
): Promise<{ posts: NormalizedPost[]; hasMore: boolean }> {
  const posts: NormalizedPost[] = [];
  let cursor: number | undefined;
  let pages = 0;
  let hasMore = false;

  while (pages < MAX_PAGES && posts.length < ctx.limit) {
    pages++;
    const data = await call({
      path: 'video/list/',
      auth,
      query: { fields: VIDEO_FIELDS },
      body: { max_count: VIDEO_PAGE_SIZE, ...(cursor !== undefined ? { cursor } : {}) },
      ctx,
    }, ctx.credentials);

    const videos = asArray(data.videos);
    let oldestOnPage: Date | undefined;

    for (const item of videos) {
      const rec = asRecord(item);
      if (!rec) continue;
      const post = readVideo(rec, username);
      if (!post) continue;
      if (!oldestOnPage || post.postedAt < oldestOnPage) oldestOnPage = post.postedAt;
      if (post.postedAt < ctx.since || post.postedAt > ctx.until) continue;
      posts.push(post);
    }

    if (posts.length >= ctx.limit) {
      posts.length = ctx.limit;
      hasMore = true;
      break;
    }

    const more = data.has_more === true;
    const nextCursor = asCount(data.cursor);
    if (!more || nextCursor <= 0 || videos.length === 0) break;
    // Everything on this page is older than the window, and paging only goes
    // further back, so there is nothing left to find.
    if (oldestOnPage && oldestOnPage < ctx.since) break;
    cursor = nextCursor;
    if (pages >= MAX_PAGES) hasMore = true;
  }

  return { posts, hasMore };
}

/* ------------------------------------------------------------- adapter */

/**
 * Owned or competitor? The pooled runner forces `cursor.__isOwned` to false,
 * and double-underscore keys are stripped before persistence. Explicit true is
 * reserved for a future org-private owned runner. The absent-flag fallback is
 * retained only for direct/legacy adapter callers.
 */
function isOwnedTikTok(ctx: FetchContext): boolean {
  const flag = ctx.cursor.__isOwned;
  return typeof flag === 'boolean' ? flag : true;
}

/**
 * Competitor read path, served by a purchased vendor rather than TikTok.
 *
 * Kept as a thin delegation so the sanctioned owned path above stays readable
 * and so the vendor can be removed by deleting one branch and one module.
 * Profile and post reads are separate vendor calls because followers and video
 * metrics come from different datasets.
 */
/**
 * Secondary competitor path used only when Bright Data is not configured.
 */
async function fetchCompetitorViaEnsemble(ctx: FetchContext, token: string): Promise<FetchResult> {
  const { fetchProfile, fetchPosts } = await import('./tiktok-ensemble');

  const { profile, audience } = await fetchProfile(ctx.handle, token, ctx.onApiCall, ctx.signal);
  const result = await fetchPosts(ctx.handle, token, {
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
    cursor: { source: 'ensembledata', lastVendorReadAt: new Date().toISOString() },
    ...(result.exhaustive
      ? { hasMore: false as const, exhaustive: true as const }
      : {
          hasMore: false as const,
          exhaustive: false as const,
          incompleteReason: result.incompleteReason
            ?? 'EnsembleData did not certify the requested TikTok window and exposed no continuation cursor.',
        }),
    warnings: result.warnings,
  };
}

async function fetchCompetitorViaVendor(ctx: FetchContext, apiKey: string): Promise<FetchResult> {
  const { fetchProfile, fetchPosts } = await import('./tiktok-brightdata');
  const pendingStage = pendingBrightDataStage(ctx.cursor, PLATFORM);
  if (
    pendingStage !== undefined
    && pendingStage !== 'tiktok-profile'
    && pendingStage !== 'tiktok-posts'
  ) {
    throw new AdapterError(
      'TikTok has a Bright Data receipt for unknown stage "' + pendingStage
        + '". Reconcile the receipt before starting another paid snapshot.',
      { platform: PLATFORM, retryable: false },
    );
  }

  let profile: AdapterProfile | undefined;
  let audience: NormalizedAudience | undefined;
  const warnings: string[] = [];

  if (pendingStage !== 'tiktok-posts') {
    const profileStage = await runBrightDataStage(ctx, {
      platform: PLATFORM,
      stage: 'tiktok-profile',
      datasetId: DATASETS.tiktokProfile,
    }, async (resumeSnapshotId) => await fetchProfile(
      ctx.handle,
      apiKey,
      ctx.onApiCall,
      ctx.signal,
      resumeSnapshotId,
    ));
    if (profileStage.kind === 'continuation') return profileStage.result;
    ({ profile, audience } = profileStage.value);
    warnings.push(...profileStage.warnings);
  } else if (!ctx.externalId?.trim()) {
    throw new AdapterError(
      'TikTok post snapshot ' + String(ctx.cursor.pendingSnapshotId)
        + ' cannot resume because the pooled channel has no verified stable platform id. '
        + 'Reconcile the profile identity before retrying; no observations were written.',
      { platform: PLATFORM, retryable: false },
    );
  }

  const postsContext = pendingStage === 'tiktok-profile'
    ? { ...ctx, cursor: { ...ctx.cursor, ...clearBrightDataReceipt() } }
    : ctx;
  const postsStage = await runBrightDataStage(postsContext, {
    platform: PLATFORM,
    stage: 'tiktok-posts',
    datasetId: DATASETS.tiktokPostsByProfile,
  }, async (resumeSnapshotId) => await fetchPosts(ctx.handle, apiKey, {
    since: ctx.since,
    until: ctx.until,
    limit: ctx.limit,
    onApiCall: ctx.onApiCall,
    signal: ctx.signal,
    resumeSnapshotId,
  }), profile, audience ? [audience] : []);
  if (postsStage.kind === 'continuation') return postsStage.result;
  const result = postsStage.value;
  warnings.push(...postsStage.warnings);

  return {
    posts: result.posts,
    audience: audience ? [audience] : [],
    ...(profile ? { profile } : {}),
    cursor: {
      source: 'brightdata',
      ...clearBrightDataReceipt(),
      lastVendorReadAt: new Date().toISOString(),
    },
    ...(result.exhaustive
      ? { hasMore: false as const, exhaustive: true as const }
      : {
          hasMore: false as const,
          exhaustive: false as const,
          incompleteReason: result.incompleteReason
            ?? 'Bright Data did not certify the requested TikTok window and exposed no continuation cursor.',
        }),
    warnings: [...result.warnings, ...warnings],
  };
}

export const tiktokAdapter: ChannelAdapter = {
  platform: PLATFORM,
  displayName: 'TikTok',
  accessNotes:
    'Pooled public collection uses Bright Data exclusively when it is configured. EnsembleData '
    + 'is used only when Bright Data is not configured; a failed or cancelled paid Bright Data '
    + 'stage is never retried through EnsembleData. '
    + 'Owned accounts can use the TikTok Display API v2 (user.info.profile, user.info.stats and '
    + 'video.list scopes). The account owner completes an OAuth consent once; access tokens last 24 '
    + 'hours and are refreshed automatically here using the 365-day refresh token. '
    + 'Owned accounts return followers, video list, views, likes, comments and shares. Saves and '
    + 'favourites are not exposed to anyone. '
    + 'COMPETITOR DATA IS NOT AVAILABLE through this API. The only sanctioned route is the TikTok '
    + 'Research API, which requires a written application, is reviewed case by case, is restricted to '
    + 'approved academic and non-profit researchers in the United States and Europe, and prohibits '
    + 'commercial use of the results. A commercial newsroom product cannot rely on it. '
    + 'COMPETITOR DATA IS THEREFORE PURCHASED. Supplying a Bright Data API key enables competitor '
    + 'reads (followers, videos, views, likes, comments, shares, saves) for any public account, which '
    + 'is full parity with what Rival IQ shows. This is public data from a vendor holding SOC 2 and '
    + 'ISO 27001, but collection is contrary to TikTok terms of service. Enable it as a documented '
    + 'decision by Legal, not a developer default. Without the key, competitor channels fail loudly '
    + 'rather than charting a silent zero. See docs/DATA-ACCESS.md.',
  credentialFields: [
    { key: 'accessToken', label: 'Access token', secret: true, required: false,
      help: 'Owned channels only. From the TikTok for Developers OAuth flow, with user.info.profile, user.info.stats and video.list scopes.' },
    { key: 'brightDataApiKey', label: 'Bright Data API key', secret: true, required: false,
      help: 'Primary pooled public source. Enables purchased public TikTok data. Read docs/DATA-ACCESS.md before enabling.' },
    { key: 'refreshToken', label: 'Refresh token', secret: true, required: false,
      help: 'Strongly recommended. Access tokens expire after 24 hours; without this every nightly run fails.' },
    { key: 'clientKey', label: 'Client key', required: false, help: 'Needed only for automatic token refresh.' },
    { key: 'clientSecret', label: 'Client secret', secret: true, required: false,
      help: 'Needed only for automatic token refresh.' },
  ],
  // TikTok documents Display API quotas per app rather than per endpoint and has
  // revised them without notice. This is a conservative pacing figure, not a
  // published guarantee.
  rateLimit: { callsPerWindow: 100, windowSeconds: 60 },
  worksUnauthenticated: false,

  parseHandle(input: string): string {
    const trimmed = input.trim();
    if (!trimmed) throw new AdapterError('Empty TikTok handle', { platform: PLATFORM, retryable: false });

    let candidate = trimmed;
    if (/^https?:\/\//i.test(trimmed)) {
      let url: URL;
      try {
        url = new URL(trimmed);
      } catch {
        throw new AdapterError(`Unparseable TikTok URL: ${input}`, { platform: PLATFORM, retryable: false });
      }
      if (!/(^|\.)tiktok\.com$/i.test(url.hostname)) {
        throw new AdapterError(`Not a TikTok URL: ${input}`, { platform: PLATFORM, retryable: false });
      }
      const found = url.pathname.split('/').filter(Boolean).find((s) => s.startsWith('@'));
      if (!found) throw new AdapterError(`No account in URL: ${input}`, { platform: PLATFORM, retryable: false });
      candidate = found;
    }

    candidate = candidate.replace(/^@/, '').toLowerCase();
    // TikTok usernames are 2-24 characters of letters, digits, underscore and dot.
    if (!/^[a-z0-9._]{2,24}$/.test(candidate)) {
      throw new AdapterError(`Invalid TikTok handle: ${input}`, { platform: PLATFORM, retryable: false });
    }
    return candidate;
  },

  /**
   * There is no lookup-by-username endpoint. The Display API only ever describes
   * the account that granted the token, so this returns that account and the
   * caller is responsible for checking it is the one they meant.
   */
  async resolveProfile(handle: string, credentials: Record<string, string>): Promise<AdapterProfile> {
    // Callers supply the public-source allowlist. Do not reach around it to
    // deployment environment variables or change vendors after a paid failure.
    const ensembleToken = credentials.ensembleDataToken?.trim() || '';
    const vendorKey = credentials.brightDataApiKey?.trim() || '';
    if (!credentials.accessToken && vendorKey) {
      const { fetchProfile } = await import('./tiktok-brightdata');
      const { profile } = await fetchProfile(handle, vendorKey);
      return profile;
    }

    if (!credentials.accessToken && ensembleToken) {
      const { fetchProfile } = await import('./tiktok-ensemble');
      const { profile } = await fetchProfile(handle, ensembleToken);
      return profile;
    }

    const auth: TikTokAuth = { accessToken: requireAccessToken(credentials) };
    const data = await call({ path: 'user/info/', auth, query: { fields: USER_FIELDS } }, credentials);
    const resolved = readUser(data, handle);
    if (handle && resolved.profile.handle.toLowerCase() !== handle.toLowerCase()) {
      throw new AdapterError(
        `This TikTok token belongs to @${resolved.profile.handle}, not @${handle}. The Display API can `
        + 'only read the account that granted it, so each TikTok channel needs its own token.',
        { platform: PLATFORM, retryable: false },
      );
    }
    return resolved.profile;
  },

  async fetch(ctx: FetchContext): Promise<FetchResult> {
    if (!isOwnedTikTok(ctx)) {
      // Competitor channel. The Display API cannot serve this, so route to the
      // purchased source selected by the deployment-wide public-source policy.
      const pendingStage = pendingBrightDataStage(ctx.cursor, PLATFORM);
      const ensembleToken = ctx.credentials.ensembleDataToken?.trim() || '';
      const vendorKey = ctx.credentials.brightDataApiKey?.trim() || '';

      if (pendingStage !== undefined && !vendorKey) {
        throw new AdapterError(
          `TikTok has a paid Bright Data snapshot waiting to resume for @${ctx.handle}, but `
            + 'the Bright Data API key is unavailable. Restore the key before using another source.',
          { platform: PLATFORM, retryable: false },
        );
      }
      if (vendorKey) return await fetchCompetitorViaVendor(ctx, vendorKey);
      if (ensembleToken) return await fetchCompetitorViaEnsemble(ctx, ensembleToken);

      throw new AdapterError(
        `TikTok public data for @${ctx.handle} requires a deployment-level Bright Data API key or, `
          + 'when Bright Data is unconfigured, an EnsembleData token. Owner OAuth collection is '
          + 'disabled until private insights have org-scoped storage. See docs/DATA-ACCESS.md.',
        { platform: PLATFORM, retryable: false },
      );
    }

    const auth: TikTokAuth = { accessToken: requireAccessToken(ctx.credentials) };
    const warnings: string[] = [];

    const userData = await call({ path: 'user/info/', auth, query: { fields: USER_FIELDS }, ctx }, ctx.credentials);
    const { profile, audience } = readUser(userData, ctx.handle);

    if (profile.handle.toLowerCase() !== ctx.handle.toLowerCase()) {
      warnings.push(
        `The configured token belongs to @${profile.handle}, but this channel is @${ctx.handle}. `
        + 'Metrics below describe the token holder.',
      );
    }

    const { posts, hasMore } = await fetchVideos(ctx, auth, profile.handle);

    if (auth.refreshedAccessToken) {
      warnings.push('The TikTok access token was refreshed during this run; update the stored credential.');
    }

    return {
      posts,
      audience: [audience],
      profile,
      cursor: {
        openId: profile.externalId,
        lastRunAt: new Date().toISOString(),
        // Surfaced, not stored as a credential: the runner does not own the
        // credential table, and a token is not cursor data. An operator or a
        // future credential-rotation job reads this.
        tokenRefreshedAt: auth.refreshedAccessToken ? new Date().toISOString() : null,
        tokenExpiresAt: auth.expiresAt ?? null,
      },
      ...(hasMore
        ? {
            // TikTok's paging cursor is not yet persisted, so rerunning would
            // start at the newest video rather than resume this window.
            hasMore: false as const,
            exhaustive: false as const,
            incompleteReason: 'TikTok Display API reached the per-run post or page limit without a persisted cursor. Add window-bound cursor persistence before certifying this requested window.',
          }
        : { hasMore: false as const, exhaustive: true as const }),
      warnings: warnings.length > 0 ? warnings : undefined,
    };
  },

  async healthCheck(credentials: Record<string, string>): Promise<{ ok: boolean; message: string }> {
    try {
      const auth: TikTokAuth = { accessToken: requireAccessToken(credentials) };
      const data = await call({ path: 'user/info/', auth, query: { fields: 'open_id,username' } }, credentials);
      const user = asRecord(data.user) ?? data;
      const username = asString(user.username) ?? asString(user.open_id) ?? 'unknown';
      const refreshed = auth.refreshedAccessToken ? ' (access token was refreshed)' : '';
      return { ok: true, message: `Token valid for @${username}.${refreshed}` };
    } catch (err) {
      if (err instanceof AdapterError) return { ok: false, message: err.message };
      return { ok: false, message: err instanceof Error ? err.message : 'Unknown error' };
    }
  },
};

export default tiktokAdapter;
