/**
 * Instagram competitor reads via Bright Data.
 *
 * Meta's sanctioned competitor path is the business_discovery edge, which needs
 * an approved Meta app plus an Instagram Business account the org controls, and
 * returns a thin slice of fields. This is the purchased alternative, used when
 * the org has no Meta credentials configured.
 *
 * One useful property of this vendor's profile endpoint: it returns the profile
 * AND a page of recent posts in a single response, so a channel costs one call
 * rather than two. The trade is depth. Roughly a dozen posts come back, which is
 * fine for a rolling window and useless for backfill, and the caller is told so
 * through a warning rather than left to infer it from a short list.
 *
 * Instagram exposes no share or save counts to anyone, including Meta's own
 * APIs, so amplification and saves are structurally zero here. They are left at
 * zero rather than estimated, and engagement total is therefore likes plus
 * comments by definition on this platform.
 */
import { AdapterError } from './types';
import type { AdapterProfile, NormalizedAudience, NormalizedPost } from './types';
import { DATASETS, scrapeSync, rowError, isErrorRow } from '@/lib/vendors/brightdata';
import { extractHashtags, extractMentions, extractUrls, toDayString } from './util/normalize';
import type { Platform, PostType } from '@/lib/types';

const PLATFORM: Platform = 'instagram';

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function pick(row: Record<string, unknown>, keys: string[]): unknown {
  for (const k of keys) {
    const v = row[k];
    if (v !== undefined && v !== null && v !== '') return v;
  }
  return undefined;
}

function num(v: unknown): number {
  if (typeof v === 'number' && Number.isFinite(v)) return Math.max(0, Math.trunc(v));
  if (typeof v === 'string') {
    const n = Number(v.replace(/[, ]/g, ''));
    if (Number.isFinite(n)) return Math.max(0, Math.trunc(n));
  }
  return 0;
}

function str(v: unknown): string | undefined {
  return typeof v === 'string' && v.trim() ? v.trim() : undefined;
}

function toDate(v: unknown): Date | undefined {
  if (typeof v === 'number') {
    const d = new Date(v < 1e12 ? v * 1000 : v);
    return Number.isNaN(d.getTime()) ? undefined : d;
  }
  if (typeof v === 'string') {
    const d = new Date(v);
    return Number.isNaN(d.getTime()) ? undefined : d;
  }
  return undefined;
}

/** Map the vendor's content_type onto our vocabulary. */
function postType(raw: unknown, hasVideo: boolean): PostType {
  const t = String(raw ?? '').toLowerCase();
  if (t.includes('reel')) return 'reel';
  if (t.includes('carousel') || t.includes('sidecar') || t.includes('album')) return 'carousel';
  if (t.includes('video')) return 'video';
  if (t.includes('image') || t.includes('photo')) return 'photo';
  return hasVideo ? 'video' : 'photo';
}

function profileUrl(handle: string): string {
  return 'https://www.instagram.com/' + handle;
}

/**
 * Normalize one real Bright Data profile row.
 *
 * Kept separate from the transport so batched election onboarding can attach
 * identities from one paid snapshot instead of purchasing the same profile
 * once per supplied URL.
 */
export function mapInstagramProfileRow(
  row: Record<string, unknown>,
  fallbackHandle: string,
): { profile: AdapterProfile; audience?: NormalizedAudience } {
  const followers = num(pick(row, ['followers', 'followers_count']));
  const resolved = str(pick(row, ['account', 'user_name', 'profile_name'])) ?? fallbackHandle;
  const externalId = str(pick(row, ['id', 'fbid', 'pk']));
  if (!externalId) {
    throw new AdapterError(
      'Bright Data returned an Instagram profile for @' + fallbackHandle
        + ' without a stable platform id. No observations were accepted.',
      { platform: PLATFORM, retryable: false },
    );
  }

  const profile: AdapterProfile = {
    externalId,
    handle: resolved.replace(/^@/, ''),
    displayName: str(pick(row, ['full_name', 'profile_name'])),
    avatarUrl: str(pick(row, ['profile_image_link', 'profile_pic_url'])) ?? null,
    profileUrl: str(pick(row, ['profile_url', 'url'])) ?? profileUrl(fallbackHandle),
    followers,
    meta: {
      source: 'brightdata',
      isVerified: Boolean(row.is_verified),
      isPrivate: Boolean(row.is_private),
      isBusiness: Boolean(row.is_business_account),
      category: str(pick(row, ['category_name', 'business_category_name'])) ?? null,
    },
  };

  const audience: NormalizedAudience | undefined = followers > 0
    ? {
      day: toDayString(new Date()),
      followers,
      following: num(pick(row, ['following'])) || null,
      extra: { posts: num(pick(row, ['posts_count'])) },
    }
    : undefined;

  return { profile, audience };
}

export async function fetchProfile(
  handle: string,
  apiKey: string,
  onApiCall?: () => void,
  signal?: AbortSignal,
  resumeSnapshotId?: string,
): Promise<{ profile: AdapterProfile; audience?: NormalizedAudience; raw: Record<string, unknown> }> {
  const rows = await scrapeSync(
    DATASETS.instagramProfile,
    [{ url: profileUrl(handle) }],
    { apiKey, platform: PLATFORM, onApiCall, signal, resumeSnapshotId },
  );

  const row = rows.find((r) => isRecord(r) && !isErrorRow(r));
  if (!isRecord(row)) {
    const why = rows.length > 0 ? rowError(rows[0]) : undefined;
    throw new AdapterError(
      'Bright Data returned no Instagram profile for @' + handle + (why ? '. ' + why : ''),
      { platform: PLATFORM, retryable: false },
    );
  }

  const { profile, audience } = mapInstagramProfileRow(row, handle);

  return { profile, audience, raw: row };
}

/**
 * Read posts out of the profile payload.
 *
 * Takes the already-fetched profile row rather than making a second call, so a
 * channel costs one request. Returns a warning when the vendor's page of posts
 * does not reach back to the requested window, because a short list would
 * otherwise read as a quiet week rather than a truncated feed.
 */
/**
 * True when a profile-embedded post stub carries at least one engagement
 * field. Around 22 Aug 2026 the vendor slimmed these stubs to seven fields
 * (caption, datetime, id, image_url, post_hashtags, content_type, url):
 * no likes, no comments, and a date-only datetime. Parsing those as posts
 * wrote three days of Instagram at zero engagement and midnight UTC, which
 * the Social Posts screen faithfully displayed as every Globe post landing
 * at 8:00 PM with nothing to show for it. A stub without engagement fields
 * is evidence a post exists, not an observation of how it performed, and
 * this adapter only writes observations.
 */
function stubHasMetrics(item: Record<string, unknown>): boolean {
  return ['likes', 'likes_count', 'comments', 'num_comments']
    .some((key) => item[key] !== undefined && item[key] !== null);
}

export function postsFromProfile(
  raw: Record<string, unknown>,
  handle: string,
  since: Date,
  until: Date,
): {
  posts: NormalizedPost[];
  warnings: string[];
  exhaustive: boolean;
  incompleteReason?: string;
  /** True when the vendor's stubs carried no engagement fields at all. */
  stubsUnusable?: boolean;
} {
  const warnings: string[] = [];
  const list = Array.isArray(raw.posts) ? raw.posts : [];
  if (list.length === 0) {
    return {
      posts: [],
      warnings,
      exhaustive: false,
      incompleteReason: 'The Instagram profile payload exposed no post history and cannot certify the requested window; use the date-ranged post dataset.',
    };
  }

  const stubs = list.filter(isRecord);
  if (stubs.length > 0 && !stubs.some(stubHasMetrics)) {
    const reason = 'Instagram for @' + handle + ': the profile payload\'s '
      + stubs.length + ' post stubs carry no engagement fields, so they are '
      + 'existence evidence rather than observations. Collect this window '
      + 'through the date-ranged post dataset.';
    return {
      posts: [],
      warnings: [reason],
      exhaustive: false,
      incompleteReason: reason,
      stubsUnusable: true,
    };
  }

  const posts: NormalizedPost[] = [];
  let oldest: Date | null = null;

  for (const item of stubs) {
    // A single metric-less stub inside an otherwise-metricked page is still
    // not writable: zero is a claim, and we cannot claim it.
    if (!stubHasMetrics(item)) continue;
    const postedAt = toDate(pick(item, ['datetime', 'date_posted', 'timestamp']));
    const externalId = str(pick(item, ['id', 'shortcode', 'post_id']));
    if (!postedAt || !externalId) continue;
    if (!oldest || postedAt < oldest) oldest = postedAt;
    if (postedAt < since || postedAt > until) continue;

    const text = str(pick(item, ['caption', 'description'])) ?? '';
    const rawTags = item.post_hashtags;
    const hashtags = Array.isArray(rawTags)
      ? rawTags.map((t) => String(t).replace(/^#/, '')).filter(Boolean)
      : extractHashtags(text);
    const videoUrl = str(item.video_url);

    posts.push({
      externalId,
      postedAt,
      type: postType(item.content_type, Boolean(videoUrl)),
      text,
      permalink: str(item.url) ?? null,
      mediaUrl: videoUrl ?? str(item.image_url) ?? null,
      thumbnailUrl: str(item.image_url) ?? null,
      durationSec: null,
      language: null,
      hashtags,
      mentions: extractMentions(text),
      urls: extractUrls(text),
      applause: num(pick(item, ['likes', 'likes_count'])),
      conversation: num(pick(item, ['comments', 'num_comments'])),
      // Instagram publishes neither to anyone. Zero is the honest value.
      amplification: 0,
      saves: 0,
      views: num(pick(item, ['views', 'video_play_count', 'video_view_count'])),
      raw: item,
    });
  }

  const incompleteReason = !oldest
    ? 'The Instagram profile payload contained no dated posts, so it cannot certify the requested window; use the date-ranged post dataset.'
    : oldest > since
      ? 'Instagram for @' + handle + ': the vendor returned ' + list.length + ' recent posts reaching back to '
        + toDayString(oldest) + ', which does not cover the requested window. Older posts are missing, '
        + 'not absent. Poll more often for complete coverage.'
      : undefined;
  if (incompleteReason) warnings.push(incompleteReason);

  return { posts, warnings, exhaustive: incompleteReason === undefined, incompleteReason };
}

/**
 * Deep post history for one profile, via the discovery endpoint.
 *
 * The profile endpoint returns a hard-capped twelve recent posts regardless of
 * limit_per_input, which for a busy newsroom account is under a week. This
 * endpoint takes the same profile URL but enumerates the account, honours a
 * date range, and returned fifty posts across two weeks in testing where the
 * profile call returned twelve across two days.
 *
 * It costs more time (roughly 90 seconds per profile) and one record per post
 * rather than one per profile, so it is the right call for a scheduled window
 * refresh and the wrong one for resolving a handle someone just typed.
 */
export async function fetchPostsByProfile(
  handle: string,
  apiKey: string,
  opts: {
    since: Date;
    until: Date;
    limit: number;
    onApiCall?: () => void;
    signal?: AbortSignal;
    resumeSnapshotId?: string;
  },
): Promise<{
  posts: NormalizedPost[];
  followers: number | null;
  /** Instagram private user id observed on the date-ranged post rows. */
  profileExternalId: string | null;
  warnings: string[];
  exhaustive: boolean;
  incompleteReason?: string;
}> {
  const fmt = (d: Date) => {
    const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
    const dd = String(d.getUTCDate()).padStart(2, '0');
    return mm + '-' + dd + '-' + d.getUTCFullYear();
  };

  const requestedPosts = Math.min(opts.limit, 200);
  const rows = await scrapeSync(
    DATASETS.instagramPost,
    [{
      url: profileUrl(handle),
      num_of_posts: requestedPosts,
      start_date: fmt(opts.since),
      end_date: fmt(opts.until),
      post_type: '',
    }],
    {
      apiKey,
      platform: PLATFORM,
      discoverBy: 'url',
      onApiCall: opts.onApiCall,
      signal: opts.signal,
      resumeSnapshotId: opts.resumeSnapshotId,
    },
  );

  const warnings: string[] = [];
  const posts: NormalizedPost[] = [];
  let followers: number | null = null;
  let profileExternalId: string | null = null;
  let sawErrorRow = false;

  for (const row of rows) {
    if (!isRecord(row)) continue;
    if (isErrorRow(row)) {
      sawErrorRow = true;
      const why = rowError(row);
      if (why) warnings.push('Instagram row error for @' + handle + ': ' + why);
      continue;
    }

    // Each post row carries the account's follower count, so audience comes
    // free rather than costing a second call.
    const f = num(pick(row, ['followers']));
    if (f > 0) followers = f;

    const rowProfileExternalId = str(pick(row, ['user_posted_id', 'owner_id']));
    const rowProfileHandle = str(pick(row, ['user_posted', 'account', 'user_name']))
      ?.replace(/^@/, '')
      .toLowerCase();
    const isRequestedProfile = rowProfileHandle === handle.replace(/^@/, '').toLowerCase();
    if (rowProfileExternalId && isRequestedProfile) {
      if (profileExternalId && profileExternalId !== rowProfileExternalId) {
        throw new AdapterError(
          'Bright Data returned multiple Instagram account ids for the requested profile @'
            + handle + '. No observations were accepted.',
          { platform: PLATFORM, retryable: false },
        );
      }
      profileExternalId = rowProfileExternalId;
    }

    const postedAt = toDate(pick(row, ['date_posted', 'datetime', 'timestamp']));
    const externalId = str(pick(row, ['post_id', 'content_id', 'pk', 'shortcode']));
    if (!postedAt || !externalId) continue;
    if (postedAt < opts.since || postedAt > opts.until) continue;

    const text = str(pick(row, ['description', 'caption', 'post_content'])) ?? '';
    const rawTags = row.hashtags ?? row.post_hashtags;
    const hashtags = Array.isArray(rawTags)
      ? rawTags.map((t) => String(t).replace(/^#/, '')).filter(Boolean)
      : extractHashtags(text);

    const contentType = pick(row, ['content_type', 'product_type']);
    const videoUrl = str(pick(row, ['video_url', 'audio_url']));

    posts.push({
      externalId,
      postedAt,
      type: postType(contentType, Boolean(videoUrl)),
      text,
      permalink: str(pick(row, ['url', 'post_url'])) ?? null,
      mediaUrl: videoUrl ?? null,
      thumbnailUrl: str(pick(row, ['thumbnail', 'display_url'])) ?? null,
      durationSec: null,
      language: null,
      hashtags,
      mentions: extractMentions(text),
      urls: extractUrls(text),
      applause: num(pick(row, ['likes', 'likes_count'])),
      conversation: num(pick(row, ['num_comments', 'comments'])),
      // Instagram publishes neither share nor save counts to anyone.
      amplification: 0,
      saves: 0,
      views: num(pick(row, ['video_view_count', 'views', 'video_play_count'])),
      raw: row,
    });
  }

  if (posts.length === 0 && rows.length > 0 && warnings.length === 0) {
    warnings.push('Instagram for @' + handle + ': rows returned but none fell inside the requested window.');
  }

  const incompleteReason = sawErrorRow
    ? 'Bright Data returned an error row for this Instagram collection; retry the date-ranged post dataset before certifying the window.'
    : rows.length >= requestedPosts
      ? 'Bright Data filled its ' + requestedPosts + '-post Instagram request without exposing a continuation cursor; narrow the window or raise the supported cap.'
      : 'Bright Data completed the Instagram snapshot but exposed no terminal cursor or completeness marker, so the requested historical window cannot be certified.';
  if (incompleteReason && !warnings.includes(incompleteReason)) warnings.push(incompleteReason);

  return {
    posts,
    followers,
    profileExternalId,
    warnings,
    exhaustive: false,
    incompleteReason,
  };
}
