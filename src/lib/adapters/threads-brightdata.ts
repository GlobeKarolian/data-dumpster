/** Threads post discovery through Bright Data's dedicated Posts collector. */
import type { NormalizedPost } from './types';
import { DATASETS, isErrorRow, rowError, scrapeSync } from '@/lib/vendors/brightdata';
import { extractHashtags, extractMentions, extractUrls } from './util/normalize';
import { isRecord, num, pick, str, toDate } from './vendor-posts';
import type { PostType } from '@/lib/types';

const PLATFORM = 'threads' as const;

function profileUrl(handle: string): string {
  return 'https://www.threads.com/@' + handle.replace(/^@/, '');
}

function stringUrls(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.map(str).filter((candidate): candidate is string => Boolean(candidate));
}

function mediaType(images: string[], videos: string[]): PostType {
  if (videos.length > 0) return 'video';
  if (images.length > 1) return 'carousel';
  if (images.length === 1) return 'photo';
  return 'text';
}

function firstVideoDuration(row: Record<string, unknown>): number | null {
  if (!Array.isArray(row.videos_duration)) return null;
  for (const value of row.videos_duration) {
    if (!isRecord(value)) continue;
    const seconds = num(pick(value, ['video_duration', 'duration']));
    if (seconds > 0) return seconds;
  }
  return null;
}

/** Exported for a fixture test built from the live vendor response. */
export function mapThreadsPost(row: Record<string, unknown>): NormalizedPost | null {
  const externalId = str(pick(row, ['post_id', 'id']));
  const postedAt = toDate(pick(row, ['post_time', 'date_posted', 'timestamp']));
  if (!externalId || !postedAt) return null;

  const text = str(pick(row, ['post_content', 'content', 'description'])) ?? '';
  const images = stringUrls(row.images);
  const videos = stringUrls(row.videos);
  const type = mediaType(images, videos);

  return {
    externalId,
    postedAt,
    type,
    text,
    permalink: str(pick(row, ['url', 'post_url'])) ?? null,
    mediaUrl: videos[0] ?? images[0] ?? null,
    thumbnailUrl: images[0] ?? null,
    durationSec: firstVideoDuration(row),
    language: null,
    hashtags: Array.isArray(row.hashtags)
      ? row.hashtags.map((tag) => String(tag).replace(/^#/, '')).filter(Boolean)
      : extractHashtags(text),
    mentions: extractMentions(text),
    urls: extractUrls(text),
    applause: num(pick(row, ['number_of_likes', 'likes', 'likes_amount'])),
    conversation: num(pick(row, ['number_of_comments', 'comments_amount', 'replies'])),
    amplification:
      num(pick(row, ['number_of_reshares', 'reshare_amount']))
      + num(pick(row, ['number_of_shares', 'share_amount'])),
    saves: 0,
    views: num(row.views),
    raw: row,
  };
}

export async function fetchThreadsPostsByProfile(
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
  warnings: string[];
  exhaustive: false;
  incompleteReason: string;
}> {
  const rows = await scrapeSync(
    DATASETS.threadsPosts,
    [{
      profile_url: profileUrl(handle),
      start_date: opts.since.toISOString(),
      end_date: opts.until.toISOString(),
    }],
    {
      apiKey,
      platform: PLATFORM,
      discoverBy: 'profile',
      onApiCall: opts.onApiCall,
      signal: opts.signal,
      resumeSnapshotId: opts.resumeSnapshotId,
    },
  );

  const warnings: string[] = [];
  const posts: NormalizedPost[] = [];
  let sawErrorRow = false;

  for (const row of rows) {
    if (!isRecord(row)) continue;
    if (isErrorRow(row)) {
      sawErrorRow = true;
      const why = rowError(row);
      if (why) warnings.push('Bright Data row error for Threads @' + handle + ': ' + why);
      continue;
    }
    const post = mapThreadsPost(row);
    if (!post || post.postedAt < opts.since || post.postedAt > opts.until) continue;
    posts.push(post);
  }

  posts.sort((a, b) => b.postedAt.getTime() - a.postedAt.getTime());
  if (posts.length > opts.limit) posts.length = opts.limit;

  const incompleteReason = sawErrorRow
    ? 'Bright Data returned an error row for this Threads collection; retry the post dataset before certifying the window.'
    : 'Bright Data returned date-ranged Threads posts with media but no terminal pagination cursor, so the historical window remains source-limited.';
  warnings.push(incompleteReason);

  return { posts, warnings, exhaustive: false, incompleteReason };
}
