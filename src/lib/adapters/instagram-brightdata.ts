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

export async function fetchProfile(
  handle: string,
  apiKey: string,
  onApiCall?: () => void,
  signal?: AbortSignal,
): Promise<{ profile: AdapterProfile; audience?: NormalizedAudience; raw: Record<string, unknown> }> {
  const rows = await scrapeSync(
    DATASETS.instagramProfile,
    [{ url: profileUrl(handle) }],
    { apiKey, platform: PLATFORM, onApiCall, signal },
  );

  const row = rows.find((r) => isRecord(r) && !isErrorRow(r));
  if (!isRecord(row)) {
    const why = rows.length > 0 ? rowError(rows[0]) : undefined;
    throw new AdapterError(
      'Bright Data returned no Instagram profile for @' + handle + (why ? '. ' + why : ''),
      { platform: PLATFORM, retryable: false },
    );
  }

  const followers = num(pick(row, ['followers', 'followers_count']));
  const resolved = str(pick(row, ['account', 'user_name', 'profile_name'])) ?? handle;

  const profile: AdapterProfile = {
    externalId: str(pick(row, ['id', 'fbid'])) ?? handle,
    handle: resolved.replace(/^@/, ''),
    displayName: str(pick(row, ['full_name', 'profile_name'])),
    avatarUrl: str(pick(row, ['profile_image_link', 'profile_pic_url'])) ?? null,
    profileUrl: str(pick(row, ['profile_url', 'url'])) ?? profileUrl(handle),
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
export function postsFromProfile(
  raw: Record<string, unknown>,
  handle: string,
  since: Date,
  until: Date,
): { posts: NormalizedPost[]; warnings: string[] } {
  const warnings: string[] = [];
  const list = Array.isArray(raw.posts) ? raw.posts : [];
  if (list.length === 0) return { posts: [], warnings };

  const posts: NormalizedPost[] = [];
  let oldest: Date | null = null;

  for (const item of list) {
    if (!isRecord(item)) continue;
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

  if (oldest && oldest > since) {
    warnings.push(
      'Instagram for @' + handle + ': the vendor returned ' + list.length + ' recent posts reaching back to '
      + toDayString(oldest) + ', which does not cover the requested window. Older posts are missing, '
      + 'not absent. Poll more often for complete coverage.',
    );
  }

  return { posts, warnings };
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
  opts: { since: Date; until: Date; limit: number; onApiCall?: () => void; signal?: AbortSignal },
): Promise<{ posts: NormalizedPost[]; followers: number | null; warnings: string[] }> {
  const fmt = (d: Date) => {
    const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
    const dd = String(d.getUTCDate()).padStart(2, '0');
    return mm + '-' + dd + '-' + d.getUTCFullYear();
  };

  const rows = await scrapeSync(
    DATASETS.instagramPost,
    [{
      url: profileUrl(handle),
      num_of_posts: Math.min(opts.limit, 200),
      start_date: fmt(opts.since),
      end_date: fmt(opts.until),
      post_type: '',
    }],
    { apiKey, platform: PLATFORM, discoverBy: 'url', onApiCall: opts.onApiCall, signal: opts.signal },
  );

  const warnings: string[] = [];
  const posts: NormalizedPost[] = [];
  let followers: number | null = null;

  for (const row of rows) {
    if (!isRecord(row)) continue;
    if (isErrorRow(row)) {
      const why = rowError(row);
      if (why) warnings.push('Instagram row error for @' + handle + ': ' + why);
      continue;
    }

    // Each post row carries the account's follower count, so audience comes
    // free rather than costing a second call.
    const f = num(pick(row, ['followers']));
    if (f > 0) followers = f;

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

  return { posts, followers, warnings };
}
