/**
 * TikTok competitor reads via Bright Data.
 *
 * The TikTok Display API only ever describes the account that granted the
 * token, and the Research API forbids commercial use, so a newsroom product has
 * no sanctioned route to a competitor's view counts. This module is the bought
 * alternative. It is kept separate from tiktok.ts so the sanctioned owned path
 * and the purchased competitor path never blur together, and so removing the
 * vendor is deleting one file plus one branch.
 *
 * Bright Data's own documentation shows two different field spellings for post
 * rows depending on endpoint (likes/comments/shares/views versus
 * digg_count/comment_count/share_count/play_count). Both are read here. A
 * scraped schema is not a contract, so every field is treated as optional.
 */
import { AdapterError } from './types';
import type { AdapterProfile, NormalizedAudience, NormalizedPost } from './types';
import { DATASETS, scrapeSync, rowError, isErrorRow } from '@/lib/vendors/brightdata';
import { extractHashtags, extractMentions, extractUrls, toDayString } from './util/normalize';
import type { Platform } from '@/lib/types';

const PLATFORM: Platform = 'tiktok';

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/** Read the first present key, tolerating both documented spellings. */
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
    const parsed = Number(v.replace(/[, ]/g, ''));
    if (Number.isFinite(parsed)) return Math.max(0, Math.trunc(parsed));
  }
  return 0;
}

function str(v: unknown): string | undefined {
  return typeof v === 'string' && v.trim() ? v.trim() : undefined;
}

function date(v: unknown): Date | undefined {
  if (typeof v === 'number') {
    // Unix seconds if it looks like seconds, milliseconds otherwise.
    const ms = v < 1e12 ? v * 1000 : v;
    const d = new Date(ms);
    return Number.isNaN(d.getTime()) ? undefined : d;
  }
  if (typeof v === 'string') {
    const d = new Date(v);
    return Number.isNaN(d.getTime()) ? undefined : d;
  }
  return undefined;
}

function profileUrl(handle: string): string {
  return 'https://www.tiktok.com/@' + handle;
}

/** Fetch one competitor profile: followers and account totals. */
export async function fetchProfile(
  handle: string,
  apiKey: string,
  onApiCall?: () => void,
  signal?: AbortSignal,
): Promise<{ profile: AdapterProfile; audience: NormalizedAudience | undefined }> {
  const rows = await scrapeSync(
    DATASETS.tiktokProfile,
    [{ url: profileUrl(handle) }],
    { apiKey, platform: PLATFORM, onApiCall, signal },
  );

  const row = rows.find((r) => isRecord(r) && !isErrorRow(r));
  if (!isRecord(row)) {
    const why = rows.length > 0 ? rowError(rows[0]) : undefined;
    throw new AdapterError(
      'Bright Data returned no TikTok profile for @' + handle + (why ? '. ' + why : ''),
      { platform: PLATFORM, retryable: false },
    );
  }

  const followers = num(pick(row, ['followers', 'follower_count', 'followers_count']));
  const resolved = str(pick(row, ['account_id', 'username', 'nickname'])) ?? handle;

  const profile: AdapterProfile = {
    externalId: str(pick(row, ['id', 'account_id'])) ?? handle,
    handle: resolved.replace(/^@/, ''),
    displayName: str(pick(row, ['nickname', 'name'])),
    avatarUrl: str(pick(row, ['profile_pic_url', 'avatar_url', 'profile_image'])) ?? null,
    profileUrl: str(row.url) ?? profileUrl(handle),
    followers,
    meta: { source: 'brightdata', isVerified: Boolean(row.is_verified) },
  };

  // Only emit an audience row when a follower reading actually came back. A
  // zero here would render as a publisher losing its entire audience.
  const audience: NormalizedAudience | undefined = followers > 0
    ? {
      day: toDayString(new Date()),
      followers,
      following: num(pick(row, ['following', 'following_count'])) || null,
      extra: {
        likes: num(pick(row, ['likes', 'total_likes', 'heart_count'])),
        videos: num(pick(row, ['videos_count', 'video_count'])),
      },
    }
    : undefined;

  return { profile, audience };
}

/**
 * Fetch a competitor's recent videos.
 *
 * Bright Data's date filter uses MM-DD-YYYY. We still filter again client side,
 * because a vendor honouring a filter approximately is a normal failure mode and
 * a post outside the window would corrupt the period comparison.
 */
export async function fetchPosts(
  handle: string,
  apiKey: string,
  opts: { since: Date; until: Date; limit: number; onApiCall?: () => void; signal?: AbortSignal },
): Promise<{ posts: NormalizedPost[]; warnings: string[] }> {
  const fmt = (d: Date) => {
    const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
    const dd = String(d.getUTCDate()).padStart(2, '0');
    return mm + '-' + dd + '-' + d.getUTCFullYear();
  };

  const rows = await scrapeSync(
    DATASETS.tiktokPostsByProfile,
    [{
      url: profileUrl(handle),
      num_of_posts: Math.min(opts.limit, 500),
      start_date: fmt(opts.since),
      end_date: fmt(opts.until),
    }],
    { apiKey, platform: PLATFORM, onApiCall: opts.onApiCall, signal: opts.signal },
  );

  const warnings: string[] = [];
  const posts: NormalizedPost[] = [];

  for (const row of rows) {
    if (!isRecord(row)) continue;
    if (isErrorRow(row)) {
      const why = rowError(row);
      if (why) warnings.push('Bright Data row error for @' + handle + ': ' + why);
      continue;
    }

    const url = str(pick(row, ['url', 'post_url', 'video_url']));
    const externalId = str(pick(row, ['post_id', 'id', 'video_id']))
      ?? (url ? url.split('/').filter(Boolean).pop() : undefined);
    const postedAt = date(pick(row, ['date_posted', 'create_time', 'created_at', 'timestamp']));

    if (!externalId || !postedAt) continue;
    if (postedAt < opts.since || postedAt > opts.until) continue;

    const text = str(pick(row, ['description', 'caption', 'title'])) ?? '';
    const rawTags = row.hashtags;
    const hashtags = Array.isArray(rawTags)
      ? rawTags.map((t) => String(t).replace(/^#/, '')).filter(Boolean)
      : extractHashtags(text);

    const durationSec = num(pick(row, ['video_duration', 'duration']));

    posts.push({
      externalId,
      postedAt,
      // Everything on TikTok is a video. Keeping the type honest matters because
      // post-type performance breakdowns are grouped on it.
      type: 'video',
      text,
      permalink: url ?? profileUrl(handle),
      mediaUrl: str(pick(row, ['video_url', 'media_url'])) ?? null,
      thumbnailUrl: str(pick(row, ['preview_image', 'thumbnail', 'cover'])) ?? null,
      durationSec: durationSec > 0 ? durationSec : null,
      language: null,
      hashtags,
      mentions: extractMentions(text),
      urls: extractUrls(text),
      applause: num(pick(row, ['likes', 'digg_count', 'like_count'])),
      conversation: num(pick(row, ['comments', 'comment_count', 'num_comments'])),
      amplification: num(pick(row, ['shares', 'share_count'])),
      saves: num(pick(row, ['collect_count', 'saves', 'favorites_count'])),
      views: num(pick(row, ['views', 'play_count', 'view_count'])),
      raw: row,
    });
  }

  if (posts.length === 0 && rows.length > 0 && warnings.length === 0) {
    warnings.push('Bright Data returned rows for @' + handle + ' but none fell inside the requested window.');
  }

  return { posts, warnings };
}
