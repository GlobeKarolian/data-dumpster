/**
 * TikTok reads via EnsembleData.
 *
 * Two endpoints: /tt/user/info for the profile and follower count, and
 * /tt/user/posts for recent videos. Both return in about two seconds, which is
 * what makes a whole-landscape refresh possible inside one request.
 *
 * The post payload nests engagement under `statistics` with TikTok's own field
 * names (digg_count, play_count), which is a good sign: this is the platform's
 * shape passed through rather than a vendor's re-interpretation of it. Verified
 * against the previous vendor on the same posts and the numbers agreed exactly.
 */
import { AdapterError } from './types';
import type { AdapterProfile, NormalizedAudience, NormalizedPost } from './types';
import { ensembleGet, envelope } from '@/lib/vendors/ensembledata';
import { isRecord, pick, num, str, toDate } from './vendor-posts';
import { extractHashtags, extractMentions, extractUrls, toDayString } from './util/normalize';
import type { Platform } from '@/lib/types';

const PLATFORM: Platform = 'tiktok';

/** TikTok media URLs arrive as { url_list: [...] } rather than a plain string. */
function firstUrl(v: unknown): string | undefined {
  const direct = str(v);
  if (direct) return direct;
  if (!isRecord(v)) return undefined;
  const list = v.url_list;
  if (Array.isArray(list)) {
    for (const u of list) {
      const s = str(u);
      if (s) return s;
    }
  }
  return str(v.url);
}

export interface TikTokEnsembleResult {
  profile: AdapterProfile;
  audience?: NormalizedAudience;
}

/**
 * Canonical public-account identity for TikTok vendor reads.
 *
 * The observed `/tt/user/info` payload carries both `user.id` and `secUid`.
 * Bright Data's observed profile payload carries the same account id as
 * `id`/`user_id`/`uid`, while `sec_uid` is a separate opaque namespace and a
 * username is mutable. Keep one namespace across source failover: the account
 * id only. `secUid` remains useful source metadata, but is never promoted to
 * `channels.external_id` and a handle is never substituted for a missing id.
 */
function stableTikTokAccountId(user: Record<string, unknown>): string | undefined {
  return str(pick(user, ['id', 'uid']));
}

export async function fetchProfile(
  handle: string,
  token: string,
  onApiCall?: () => void,
  signal?: AbortSignal,
): Promise<TikTokEnsembleResult> {
  const body = await ensembleGet('/tt/user/info', { username: handle }, {
    token, platform: PLATFORM, onApiCall, signal,
  });
  const data = envelope<Record<string, unknown>>(body);
  const user = isRecord(data?.user) ? data.user : undefined;
  const stats = isRecord(data?.stats) ? data.stats
    : isRecord(data?.statsV2) ? data.statsV2 : undefined;

  if (!user) {
    throw new AdapterError(
      'EnsembleData returned no TikTok profile for @' + handle + '.',
      { platform: PLATFORM, retryable: false },
    );
  }

  const followers = num(pick(stats ?? {}, ['followerCount', 'follower_count']));
  const externalId = stableTikTokAccountId(user);
  if (!externalId) {
    throw new AdapterError(
      'EnsembleData returned a TikTok profile for @' + handle
        + ' without the canonical stable account id (`user.id`/`user.uid`). '
        + 'A username or secUid cannot replace it; no observations were accepted.',
      { platform: PLATFORM, retryable: false },
    );
  }

  const profile: AdapterProfile = {
    externalId,
    handle: str(pick(user, ['uniqueId', 'unique_id'])) ?? handle,
    displayName: str(pick(user, ['nickname'])),
    avatarUrl: str(pick(user, ['avatarLarger', 'avatar_larger', 'avatarMedium'])) ?? null,
    profileUrl: 'https://www.tiktok.com/@' + handle,
    followers,
    meta: {
      source: 'ensembledata',
      isVerified: Boolean(user.verified),
      secUid: str(pick(user, ['secUid'])) ?? null,
    },
  };

  const audience: NormalizedAudience | undefined = followers > 0
    ? {
      day: toDayString(new Date()),
      followers,
      following: num(pick(stats ?? {}, ['followingCount'])) || null,
      extra: {
        hearts: num(pick(stats ?? {}, ['heartCount', 'heart'])),
        videos: num(pick(stats ?? {}, ['videoCount'])),
      },
    }
    : undefined;

  return { profile, audience };
}

/**
 * Recent videos for one account.
 *
 * `depth` is the vendor's paging unit: each level returns roughly ten posts and
 * costs one unit. We ask for enough depth to cover the window and then filter
 * client side, because the endpoint has no date parameter and a vendor honouring
 * a window approximately would corrupt period comparisons.
 */
export async function fetchPosts(
  handle: string,
  token: string,
  opts: { since: Date; until: Date; limit: number; onApiCall?: () => void; signal?: AbortSignal },
): Promise<{
  posts: NormalizedPost[];
  warnings: string[];
  exhaustive: boolean;
  incompleteReason?: string;
}> {
  const depth = Math.max(1, Math.min(Math.ceil(opts.limit / 10), 10));

  const body = await ensembleGet('/tt/user/posts', { username: handle, depth }, {
    token, platform: PLATFORM, onApiCall: opts.onApiCall, signal: opts.signal,
  });

  const rows = envelope<unknown[]>(body) ?? [];
  const warnings: string[] = [];
  const posts: NormalizedPost[] = [];
  let oldest: Date | null = null;

  for (const row of rows) {
    if (!isRecord(row)) continue;
    const stats = isRecord(row.statistics) ? row.statistics : {};

    const externalId = str(pick(row, ['aweme_id', 'id']));
    const postedAt = toDate(pick(row, ['create_time', 'createTime']));
    if (!externalId || !postedAt) continue;
    if (!oldest || postedAt < oldest) oldest = postedAt;
    if (postedAt < opts.since || postedAt > opts.until) continue;

    const text = str(pick(row, ['desc', 'description'])) ?? '';
    const video = isRecord(row.video) ? row.video : undefined;
    const duration = video ? num(pick(video, ['duration'])) : 0;

    posts.push({
      externalId,
      postedAt,
      type: 'video',
      text,
      permalink: 'https://www.tiktok.com/@' + handle + '/video/' + externalId,
      mediaUrl: firstUrl(video?.play_addr) ?? firstUrl(video?.download_addr) ?? null,
      // Covers arrive as TikTok's url_list arrays, signed and expiring. Take the
      // first entry: a post library that shows text where every other platform
      // shows an image reads as broken data rather than a design choice.
      thumbnailUrl: firstUrl(video?.cover) ?? firstUrl(video?.origin_cover) ?? null,
      durationSec: duration > 0 ? Math.round(duration / (duration > 1000 ? 1000 : 1)) : null,
      language: str(pick(row, ['desc_language'])) ?? null,
      hashtags: extractHashtags(text),
      mentions: extractMentions(text),
      urls: extractUrls(text),
      applause: num(pick(stats, ['digg_count'])),
      conversation: num(pick(stats, ['comment_count'])),
      amplification: num(pick(stats, ['share_count', 'forward_count'])),
      saves: num(pick(stats, ['collect_count'])),
      views: num(pick(stats, ['play_count'])),
      raw: row,
    });
  }

  const incompleteReason = oldest && oldest > opts.since && rows.length > 0
    ? 'TikTok for @' + handle + ': the vendor returned ' + rows.length + ' posts reaching back to '
      + toDayString(oldest) + ', which does not cover the requested window and exposes no continuation cursor. Raise depth or poll more often.'
    : rows.length > 0 && !oldest
      ? 'The TikTok response contained no parseable dated posts, so the requested window cannot be certified; inspect the vendor response shape.'
      : rows.length === 0
        ? 'EnsembleData returned an empty recent TikTok feed without a terminal pagination marker, so the requested window is unmeasured rather than certified empty.'
      : undefined;
  if (incompleteReason) warnings.push(incompleteReason);

  return { posts, warnings, exhaustive: incompleteReason === undefined, incompleteReason };
}
