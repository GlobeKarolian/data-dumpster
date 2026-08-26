/**
 * YouTube — Data API v3.
 *
 * What this adapter can and cannot see, stated up front because the gaps drive
 * every design decision below:
 *
 *  - **There is no share count.** The v3 API removed `shareCount` from
 *    `videos.statistics` years ago; it survives only in YouTube Analytics, which
 *    requires an owner OAuth token for the channel. We are measuring
 *    *competitors*, so we will never have that token. `amplification` is
 *    therefore always 0 rather than a guess, and the metric definitions layer is
 *    responsible for saying "not available on YouTube" instead of "zero shares".
 *  - **`dislikeCount` is gone** for everyone since Dec 2021, so there is no
 *    sentiment signal here at all.
 *  - **`subscriberCount` is rounded** to three significant figures (1.23M, not
 *    1,234,567) and can be hidden entirely by the channel owner. Day-over-day
 *    audience deltas for small channels are therefore quantisation noise; the
 *    exact value we got is preserved in `extra.subscriberCountIsExact` so charts
 *    can degrade honestly.
 *  - **Comments can be disabled per video**, in which case `commentCount` is
 *    absent — which is not the same as zero, but is stored as zero because the
 *    schema has nowhere to put "unknown". Noted here so nobody later reads a
 *    zero as engagement failure.
 *
 * Quota: the default project allowance is 10,000 units/day. `list` calls cost 1
 * unit each regardless of how many ids you pass, which is why video stats are
 * fetched in batches of 50 — the maximum the API accepts — rather than per
 * video. A channel posting 50 videos in a window costs 1 (resolve) + 1
 * (playlist page) + 1 (stats batch) = 3 units.
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

const PLATFORM: Platform = 'youtube';
const API = 'https://www.googleapis.com/youtube/v3';

/** The API rejects `id` lists longer than this. */
const MAX_IDS_PER_STATS_CALL = 50;
/** `maxResults` ceiling for playlistItems. */
const MAX_PLAYLIST_PAGE = 50;
/** Stop paging even if `since` has not been reached; protects against a channel
 *  with a 20,000-video upload playlist eating the whole daily quota. */
const MAX_PLAYLIST_PAGES = 20;

/** Canonical channel ids are always `UC` + 22 url-safe base64 chars. */
const CHANNEL_ID_RE = /^UC[\w-]{22}$/;

/* ------------------------------------------------------------- helpers */

/**
 * Google reports several very different problems as HTTP 403. Getting this
 * classification wrong is expensive in both directions: retrying a
 * `quotaExceeded` burns nothing but wall-clock (the quota resets at midnight
 * Pacific, not in 30 seconds), while giving up on `rateLimitExceeded` drops a
 * channel that would have succeeded a second later.
 */
function classifyGoogleError(ctx: { status: number; parsed: unknown }): boolean | undefined {
  if (ctx.status !== 403) return undefined;
  const reason = googleErrorReason(ctx.parsed);
  if (reason === 'rateLimitExceeded' || reason === 'userRateLimitExceeded' || reason === 'backendError') return true;
  if (reason === 'quotaExceeded' || reason === 'dailyLimitExceeded') return false;
  // forbidden / accessNotConfigured / keyInvalid: a human has to fix something.
  return false;
}

function googleErrorReason(parsed: unknown): string | undefined {
  const err = asRecord(asRecord(parsed)?.error);
  const first = asRecord(asArray(err?.errors)[0]);
  return asString(first?.reason);
}

/**
 * ISO-8601 durations, as YouTube emits them: `PT4M13S`, `PT1H2M3S`, `P1DT2H`,
 * and — for live streams that never ended — `P0D`. Anything unparseable returns
 * null rather than 0, because 0 would classify a long video as a Short.
 */
export function parseIso8601Duration(value: string | undefined): number | null {
  if (!value) return null;
  const m = /^P(?:(\d+(?:\.\d+)?)D)?(?:T(?:(\d+(?:\.\d+)?)H)?(?:(\d+(?:\.\d+)?)M)?(?:(\d+(?:\.\d+)?)S)?)?$/.exec(value.trim());
  if (!m) return null;
  const [, d, h, min, s] = m;
  if (!d && !h && !min && !s) return null;
  const seconds = (Number(d ?? 0) * 86400) + (Number(h ?? 0) * 3600) + (Number(min ?? 0) * 60) + Number(s ?? 0);
  return Number.isFinite(seconds) && seconds > 0 ? Math.round(seconds) : null;
}

function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

function requireApiKey(credentials: Record<string, string>): string {
  const key = credentials.apiKey?.trim();
  if (!key) {
    throw new AdapterError(
      'YouTube requires a Data API v3 key. Add one in Settings → Platform credentials.',
      { platform: PLATFORM, retryable: false },
    );
  }
  return key;
}

interface YouTubeRequestOpts {
  apiKey: string;
  query: Record<string, string | number | undefined>;
  ctx?: Pick<FetchContext, 'onApiCall' | 'signal'>;
}

function call<T>(path: string, opts: YouTubeRequestOpts): Promise<T> {
  return fetchJson<T>(`${API}/${path}`, {
    platform: PLATFORM,
    query: { ...opts.query, key: opts.apiKey },
    onApiCall: opts.ctx?.onApiCall,
    signal: opts.ctx?.signal,
    classifyRetryable: classifyGoogleError,
  });
}

/* ------------------------------------------------------------ resolving */

interface ResolvedChannel {
  channelId: string;
  uploadsPlaylistId: string;
  profile: AdapterProfile;
  audience: NormalizedAudience;
}

function readChannelItem(item: Record<string, unknown>, handle: string): ResolvedChannel {
  const channelId = asString(item.id);
  const snippet = asRecord(item.snippet);
  const stats = asRecord(item.statistics);
  const uploads = asString(asRecord(asRecord(item.contentDetails)?.relatedPlaylists)?.uploads);

  if (!channelId || !uploads) {
    throw new AdapterError(
      `YouTube returned a channel with no id or uploads playlist for "${handle}"`,
      { platform: PLATFORM, retryable: false },
    );
  }

  const thumbs = asRecord(snippet?.thumbnails);
  const avatar = asString(asRecord(thumbs?.high)?.url) ?? asString(asRecord(thumbs?.default)?.url);
  const customUrl = asString(snippet?.customUrl);
  const hiddenSubs = asRecord(item.statistics)?.hiddenSubscriberCount === true;
  const followers = asCount(stats?.subscriberCount);

  return {
    channelId,
    uploadsPlaylistId: uploads,
    profile: {
      externalId: channelId,
      handle: (customUrl ?? handle).replace(/^@/, ''),
      displayName: asString(snippet?.title),
      avatarUrl: avatar ?? null,
      profileUrl: `https://www.youtube.com/${customUrl ?? `channel/${channelId}`}`,
      followers,
      meta: {
        country: asString(snippet?.country) ?? null,
        publishedAt: asString(snippet?.publishedAt) ?? null,
        hiddenSubscriberCount: hiddenSubs,
        uploadsPlaylistId: uploads,
      },
    },
    audience: {
      day: toDayString(new Date()),
      followers,
      extra: {
        // Channel-lifetime totals. Useful as a sanity check on per-video views,
        // and the only "views" number that exists for a channel with hidden subs.
        totalViews: asCount(stats?.viewCount),
        videoCount: asCount(stats?.videoCount),
        // 1 = the number is exact, 0 = YouTube rounded or hid it. `extra` is a
        // number map, so this is the only way to carry the caveat forward.
        subscriberCountIsExact: hiddenSubs ? 0 : (followers > 0 && followers < 1000 ? 1 : 0),
      },
    },
  };
}

async function resolveChannel(
  handle: string,
  apiKey: string,
  ctx?: Pick<FetchContext, 'onApiCall' | 'signal'>,
): Promise<ResolvedChannel> {
  const clean = handle.replace(/^@/, '');
  // `forHandle` is the modern lookup; `id` is used when the caller already has
  // a UC… id, which is both cheaper and immune to handle changes.
  const query = CHANNEL_ID_RE.test(clean)
    ? { part: 'snippet,statistics,contentDetails', id: clean }
    : { part: 'snippet,statistics,contentDetails', forHandle: `@${clean}` };

  const body = await call<unknown>('channels', { apiKey, query, ctx });
  const items = asArray(asRecord(body)?.items);
  const first = asRecord(items[0]);
  if (!first) {
    throw new AdapterError(`No YouTube channel found for "${handle}"`, { platform: PLATFORM, retryable: false });
  }
  return readChannelItem(first, clean);
}

/* -------------------------------------------------------------- fetching */

interface UploadRef {
  videoId: string;
  publishedAt: Date;
}

/**
 * Walk the uploads playlist newest-first, stopping as soon as we cross `since`.
 *
 * `playlistItems` with `part=contentDetails` already carries
 * `videoPublishedAt`, so the cutoff is decided *before* spending a quota unit on
 * video statistics. That is the whole reason this is two calls rather than one.
 *
 * Caveat worth knowing: the uploads playlist is ordered by upload time, which is
 * not always publish time for scheduled premieres. We therefore do not break on
 * the first old item — we break when an entire page is older than `since`.
 */
async function collectUploads(
  uploadsPlaylistId: string,
  apiKey: string,
  ctx: FetchContext,
  initialPageToken?: string,
): Promise<{ refs: UploadRef[]; hasMore: boolean; nextPageToken?: string }> {
  const refs: UploadRef[] = [];
  let pageToken = initialPageToken;
  let pages = 0;
  let nextPageToken: string | undefined;

  if (ctx.limit <= 0) return { refs, hasMore: false };

  while (pages < MAX_PLAYLIST_PAGES) {
    pages++;
    const body = await call<unknown>('playlistItems', {
      apiKey,
      query: {
        part: 'contentDetails',
        playlistId: uploadsPlaylistId,
        // Never fetch more rows than this run can accept. Besides saving quota,
        // this keeps the returned nextPageToken immediately after the final
        // accepted row instead of skipping the remainder of a fetched page.
        maxResults: Math.min(MAX_PLAYLIST_PAGE, ctx.limit - refs.length),
        pageToken,
      },
      ctx,
    });

    const root = asRecord(body);
    const items = asArray(root?.items);
    nextPageToken = asString(root?.nextPageToken);
    let newestOnPage: Date | undefined;

    for (const raw of items) {
      const details = asRecord(asRecord(raw)?.contentDetails);
      const videoId = asString(details?.videoId);
      const publishedAt = asDate(details?.videoPublishedAt);
      // Private or deleted uploads keep a playlist row but lose their timestamp.
      if (!videoId || !publishedAt) continue;
      if (!newestOnPage || publishedAt > newestOnPage) newestOnPage = publishedAt;
      if (publishedAt < ctx.since || publishedAt > ctx.until) continue;
      refs.push({ videoId, publishedAt });
    }

    if (refs.length >= ctx.limit) {
      refs.length = ctx.limit;
      return {
        refs,
        hasMore: Boolean(nextPageToken),
        nextPageToken,
      };
    }

    if (!nextPageToken) return { refs, hasMore: false };
    // Every item on this page predates the window: nothing older can qualify.
    if (newestOnPage && newestOnPage < ctx.since) return { refs, hasMore: false };
    pageToken = nextPageToken;
  }

  return {
    refs,
    hasMore: Boolean(nextPageToken),
    nextPageToken,
  };
}

function resumablePageToken(
  ctx: FetchContext,
  uploadsPlaylistId: string,
): string | undefined {
  const token = asString(ctx.cursor.nextPageToken);
  if (!token) return undefined;

  const cursorPlaylist = asString(ctx.cursor.uploadsPlaylistId);
  if (cursorPlaylist && cursorPlaylist !== uploadsPlaylistId) return undefined;

  const windowSince = asString(ctx.cursor.windowSince);
  const windowUntil = asString(ctx.cursor.windowUntil);
  if (!windowSince && !windowUntil) return token;
  return windowSince === ctx.since.toISOString() && windowUntil === ctx.until.toISOString()
    ? token
    : undefined;
}

function toPost(item: Record<string, unknown>): NormalizedPost | undefined {
  const videoId = asString(item.id);
  const snippet = asRecord(item.snippet);
  const stats = asRecord(item.statistics);
  const details = asRecord(item.contentDetails);
  const postedAt = asDate(snippet?.publishedAt);
  if (!videoId || !postedAt) return undefined;

  const title = asString(snippet?.title) ?? '';
  const description = asString(snippet?.description) ?? '';
  // Title and description are separate fields on YouTube but a single "caption"
  // everywhere else, so they are joined for text search and tag rules. The
  // title stays first so keyword matches on headlines still rank naturally.
  const text = [title, description].filter(Boolean).join('\n\n');

  const durationSec = parseIso8601Duration(asString(details?.duration));
  const liveState = asString(snippet?.liveBroadcastContent);
  const thumbs = asRecord(snippet?.thumbnails);
  const thumbnail = asString(asRecord(thumbs?.maxres)?.url)
    ?? asString(asRecord(thumbs?.high)?.url)
    ?? asString(asRecord(thumbs?.default)?.url);

  // Tags are a separate keyword field on YouTube; they are not hashtags and are
  // not shown to viewers, so they are merged in as hashtags only after the ones
  // the creator actually wrote in the description.
  const declaredTags = asArray(snippet?.tags)
    .map((t) => asString(t))
    .filter((t): t is string => Boolean(t))
    .map((t) => t.replace(/^#/, '').toLowerCase());

  const hashtags = Array.from(new Set([...extractHashtags(text), ...declaredTags]));

  return {
    externalId: videoId,
    postedAt,
    type: classifyPostType({
      platform: PLATFORM,
      hasVideo: true,
      durationSec,
      isLive: liveState === 'live',
    }),
    text: text || null,
    permalink: `https://www.youtube.com/watch?v=${videoId}`,
    mediaUrl: `https://www.youtube.com/watch?v=${videoId}`,
    thumbnailUrl: thumbnail ?? null,
    durationSec,
    language: asString(snippet?.defaultAudioLanguage) ?? asString(snippet?.defaultLanguage) ?? null,
    hashtags,
    mentions: extractMentions(description),
    urls: extractUrls(description),
    applause: asCount(stats?.likeCount),
    conversation: asCount(stats?.commentCount),
    // No share count exists in Data API v3 — see the file header. Zero here
    // means "not exposed", not "nobody shared it".
    amplification: 0,
    // No bookmark/save signal on YouTube either.
    saves: 0,
    views: asCount(stats?.viewCount),
    raw: {
      channelId: asString(snippet?.channelId) ?? null,
      categoryId: asString(snippet?.categoryId) ?? null,
      liveBroadcastContent: liveState ?? null,
      duration: asString(details?.duration) ?? null,
      definition: asString(details?.definition) ?? null,
      caption: asString(details?.caption) ?? null,
      favoriteCount: asCount(stats?.favoriteCount),
    },
  };
}

async function fetchVideoStats(
  ids: string[],
  apiKey: string,
  ctx: FetchContext,
): Promise<NormalizedPost[]> {
  const posts: NormalizedPost[] = [];
  for (const batch of chunk(ids, MAX_IDS_PER_STATS_CALL)) {
    const body = await call<unknown>('videos', {
      apiKey,
      query: { part: 'snippet,statistics,contentDetails', id: batch.join(',') },
      ctx,
    });
    for (const raw of asArray(asRecord(body)?.items)) {
      const rec = asRecord(raw);
      if (!rec) continue;
      const post = toPost(rec);
      if (post) posts.push(post);
    }
  }
  return posts;
}

/* ------------------------------------------------------------- adapter */

export const youtubeAdapter: ChannelAdapter = {
  platform: PLATFORM,
  displayName: 'YouTube',
  accessNotes:
    'Needs a YouTube Data API v3 key from a Google Cloud project (no OAuth, no channel ownership). '
    + 'Public data only: views, likes and comment counts. Shares and impressions are owner-only via '
    + 'YouTube Analytics and are always reported as 0 here. Default quota is 10,000 units/day, and one '
    + 'channel refresh costs roughly 3 units per 50 videos.',
  credentialFields: [
    { key: 'apiKey', label: 'YouTube Data API key', secret: true, required: true,
      help: 'Google Cloud → APIs & Services → Credentials → API key, with YouTube Data API v3 enabled.' },
  ],
  rateLimit: { callsPerWindow: 10_000, windowSeconds: 86_400 },
  worksUnauthenticated: false,

  /**
   * Accepts every shape a person might paste: `@handle`, a bare handle, a
   * `/channel/UC…` URL, and the legacy `/c/` and `/user/` vanity paths. The
   * legacy forms are returned as-is and resolved by `forHandle`, which is what
   * the API does with them in practice.
   */
  parseHandle(input: string): string {
    const trimmed = input.trim();
    if (!trimmed) throw new AdapterError('Empty YouTube handle', { platform: PLATFORM, retryable: false });

    if (/^https?:\/\//i.test(trimmed)) {
      let url: URL;
      try {
        url = new URL(trimmed);
      } catch {
        throw new AdapterError(`Unparseable YouTube URL: ${input}`, { platform: PLATFORM, retryable: false });
      }
      if (!/(^|\.)youtube\.com$/i.test(url.hostname) && !/(^|\.)youtu\.be$/i.test(url.hostname)) {
        throw new AdapterError(`Not a YouTube URL: ${input}`, { platform: PLATFORM, retryable: false });
      }
      const segments = url.pathname.split('/').filter(Boolean);
      if (segments.length === 0) {
        throw new AdapterError(`YouTube URL has no channel in it: ${input}`, { platform: PLATFORM, retryable: false });
      }
      const [first, second] = segments;
      if (first.startsWith('@')) return first.slice(1);
      if ((first === 'channel' || first === 'c' || first === 'user') && second) return second;
      // The oldest vanity form is a bare path: youtube.com/FoxNewsChannel.
      // YouTube still serves these, and half the CSVs in the wild carry them.
      // Anything that is not a reserved content path is a vanity name, handed
      // to `forHandle` exactly like the `/c/` form.
      const RESERVED = new Set([
        'watch', 'shorts', 'playlist', 'results', 'feed', 'embed', 'live',
        'post', 'clip', 'hashtag', 'source', 'account', 'gaming', 'music',
        'premium', 'about', 'upload', 't', 's',
      ]);
      if (segments.length === 1 && !RESERVED.has(first.toLowerCase())
          && /^[A-Za-z0-9._-]{1,100}$/.test(first)) {
        return first;
      }
      throw new AdapterError(`Could not find a channel in: ${input}`, { platform: PLATFORM, retryable: false });
    }

    const handle = trimmed.replace(/^@/, '');
    if (!/^[A-Za-z0-9._-]{1,100}$/.test(handle)) {
      throw new AdapterError(`Invalid YouTube handle: ${input}`, { platform: PLATFORM, retryable: false });
    }
    return handle;
  },

  async resolveProfile(handle: string, credentials: Record<string, string>): Promise<AdapterProfile> {
    const resolved = await resolveChannel(handle, requireApiKey(credentials));
    return resolved.profile;
  },

  async fetch(ctx: FetchContext): Promise<FetchResult> {
    const apiKey = requireApiKey(ctx.credentials);
    const warnings: string[] = [];

    // The uploads playlist id is derived from the channel id and never changes,
    // so it is cached on the channel cursor. Re-resolving every run would still
    // be correct, just a wasted quota unit — but we do re-resolve anyway because
    // that same call is the only source of the daily subscriber count.
    const resolved = await resolveChannel(ctx.externalId ?? ctx.handle, apiKey, ctx);
    const cachedUploads = typeof ctx.cursor.uploadsPlaylistId === 'string' ? ctx.cursor.uploadsPlaylistId : undefined;
    if (cachedUploads && cachedUploads !== resolved.uploadsPlaylistId) {
      warnings.push('Uploads playlist id changed; the channel may have been migrated.');
    }

    if (resolved.profile.meta?.hiddenSubscriberCount === true) {
      warnings.push('This channel hides its subscriber count, so audience metrics will read 0.');
    }

    const { refs, hasMore, nextPageToken } = await collectUploads(
      resolved.uploadsPlaylistId,
      apiKey,
      ctx,
      resumablePageToken(ctx, resolved.uploadsPlaylistId),
    );
    const posts = refs.length > 0
      ? await fetchVideoStats(refs.map((r) => r.videoId), apiKey, ctx)
      : [];

    // `videos.list` silently drops ids it will not serve (private, deleted,
    // region-blocked). Surface the gap rather than letting post counts drift.
    if (posts.length < refs.length) {
      warnings.push(`${refs.length - posts.length} upload(s) were not returned by videos.list (private, deleted or blocked).`);
    }

    return {
      posts,
      audience: [resolved.audience],
      profile: resolved.profile,
      cursor: {
        uploadsPlaylistId: resolved.uploadsPlaylistId,
        channelId: resolved.channelId,
        windowSince: ctx.since.toISOString(),
        windowUntil: ctx.until.toISOString(),
        // Null is intentional: the runner merges cursors, so omitting this key
        // after completion would leave the previous continuation token alive.
        nextPageToken: hasMore ? nextPageToken ?? null : null,
        // The runner uses this generic alias to preserve the requested window
        // when a partial channel is resumed outside the collection queue.
        nextCursor: hasMore ? nextPageToken ?? null : null,
        lastRunAt: new Date().toISOString(),
        newestPostedAt: posts.reduce<string | null>(
          (acc, p) => (!acc || p.postedAt.toISOString() > acc ? p.postedAt.toISOString() : acc), null,
        ),
      },
      ...(hasMore
        ? {
            hasMore: true as const,
            exhaustive: false as const,
            incompleteReason: 'YouTube stopped at the per-run upload or page limit; resume the saved page token before certifying this requested window.',
          }
        : { hasMore: false as const, exhaustive: true as const }),
      warnings: warnings.length > 0 ? warnings : undefined,
    };
  },

  /**
   * One unit of quota against a channel that is guaranteed to exist. This
   * validates the key, that the API is enabled on the project, and that the key
   * is not IP/referrer-restricted away from this server — the three ways a
   * pasted key fails in practice.
   */
  async healthCheck(credentials: Record<string, string>): Promise<{ ok: boolean; message: string }> {
    try {
      const apiKey = requireApiKey(credentials);
      await call<unknown>('channels', { apiKey, query: { part: 'id', forHandle: '@YouTube' } });
      return { ok: true, message: 'Key accepted by the YouTube Data API.' };
    } catch (err) {
      if (err instanceof AdapterError) return { ok: false, message: err.message };
      return { ok: false, message: err instanceof Error ? err.message : 'Unknown error' };
    }
  },
};

export default youtubeAdapter;
