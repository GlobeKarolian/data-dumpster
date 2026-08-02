/**
 * Instagram via EnsembleData.
 *
 * WHY THIS REPLACED THE PREVIOUS INSTAGRAM PATH
 * Two bugs, both caused by reading the wrong endpoint rather than by bad code.
 * Every Instagram post in the database is stored with zero views and none is
 * typed as a reel, because the previous vendor reports content_type Video for
 * reels and feed videos alike, product_type null on both, and carries no play
 * count anywhere in its payload.
 *
 * Instagram splits this across two endpoints and so must we:
 *   /instagram/user/posts  feed posts. No play count on video posts.
 *   /instagram/user/reels  reels only, WITH play_count and product_type clips.
 *
 * That is the whole reason reels are fetched separately. It costs one extra
 * call per channel and is the only way to know a reel is a reel or how many
 * times anything was watched.
 *
 * Both endpoints take oldest_timestamp, so the window is requested rather than
 * over-fetched and filtered, which is why depth stays small.
 */
import { AdapterError } from './types';
import type { AdapterProfile, NormalizedAudience, NormalizedPost } from './types';
import { ensembleGet, envelope } from '@/lib/vendors/ensembledata';
import { isRecord, pick, num, str } from './vendor-posts';
import { extractHashtags, extractMentions, extractUrls, toDayString } from './util/normalize';
import type { Platform, PostType } from '@/lib/types';

const PLATFORM: Platform = 'instagram';

/** Instagram timestamps are unix seconds. */
function fromUnix(v: unknown): Date | undefined {
  const n = num(v);
  if (n <= 0) return undefined;
  const d = new Date(n < 1e12 ? n * 1000 : n);
  return Number.isNaN(d.getTime()) ? undefined : d;
}

function countOf(v: unknown): number {
  return isRecord(v) ? num(v.count) : 0;
}

/** Caption lives under a GraphQL edge list in the feed shape. */
function captionOf(node: Record<string, unknown>): string {
  const edge = node.edge_media_to_caption;
  if (isRecord(edge) && Array.isArray(edge.edges) && edge.edges.length > 0) {
    const first = edge.edges[0];
    if (isRecord(first) && isRecord(first.node)) return str(first.node.text) ?? '';
  }
  const cap = node.caption;
  if (isRecord(cap)) return str(cap.text) ?? '';
  return str(node.caption) ?? '';
}

/** First usable URL from Instagram's ordered media rendition arrays. */
function firstRenditionUrl(value: unknown): string | undefined {
  if (!Array.isArray(value)) return undefined;
  for (const rendition of value) {
    if (!isRecord(rendition)) continue;
    const url = str(rendition.url);
    if (url) return url;
  }
  return undefined;
}

/**
 * Profile plus the numeric user id every other endpoint needs.
 *
 * detailed-info costs 10 units against basic-info at 4, and is worth it: it
 * returns follower count, media count and the id in one call, where the cheaper
 * endpoint would still need a separate lookup to resolve the handle.
 */
export async function fetchProfile(
  handle: string,
  token: string,
  onApiCall?: () => void,
  signal?: AbortSignal,
): Promise<{ userId: string; profile: AdapterProfile; audience?: NormalizedAudience }> {
  const body = await ensembleGet('/instagram/user/detailed-info', { username: handle }, {
    token, platform: PLATFORM, onApiCall, signal,
  });
  const data = envelope<Record<string, unknown>>(body) ?? {};
  const user = isRecord(data.user) ? data.user : data;

  const userId = str(pick(user, ['id', 'pk', 'eimu_id']));
  if (!userId) {
    throw new AdapterError(
      'EnsembleData returned no Instagram profile for @' + handle + '.',
      { platform: PLATFORM, retryable: false },
    );
  }

  const followers = countOf(user.edge_followed_by);

  const profile: AdapterProfile = {
    externalId: userId,
    handle: str(user.username) ?? handle,
    displayName: str(user.full_name),
    avatarUrl: str(pick(user, ['profile_pic_url_hd', 'profile_pic_url'])) ?? null,
    profileUrl: 'https://www.instagram.com/' + handle,
    followers,
    meta: {
      source: 'ensembledata',
      isVerified: Boolean(user.is_verified),
      isPrivate: Boolean(user.is_private),
      category: str(pick(user, ['category_name', 'business_category_name'])) ?? null,
    },
  };

  const audience: NormalizedAudience | undefined = followers > 0
    ? {
      day: toDayString(new Date()),
      followers,
      following: countOf(user.edge_follow) || null,
      extra: { posts: countOf(user.edge_owner_to_timeline_media) },
    }
    : undefined;

  return { userId, profile, audience };
}

/** Feed posts. GraphQL edge shape, no play counts on video nodes. */
function readFeedNode(node: Record<string, unknown>): NormalizedPost | undefined {
  const externalId = str(pick(node, ['id', 'pk']));
  const postedAt = fromUnix(pick(node, ['taken_at_timestamp', 'taken_at']));
  if (!externalId || !postedAt) return undefined;

  const typename = str(node.__typename) ?? '';
  const isVideo = Boolean(node.is_video) || typename.includes('Video');
  const type: PostType = typename.includes('Sidecar') ? 'carousel' : isVideo ? 'video' : 'photo';

  const text = captionOf(node);
  const code = str(node.shortcode);

  return {
    externalId,
    postedAt,
    type,
    text,
    permalink: code ? 'https://www.instagram.com/p/' + code + '/' : null,
    mediaUrl: str(node.video_url) ?? null,
    thumbnailUrl: str(pick(node, ['display_url', 'thumbnail_src'])) ?? null,
    durationSec: null,
    language: null,
    hashtags: extractHashtags(text),
    mentions: extractMentions(text),
    urls: extractUrls(text),
    applause: countOf(node.edge_liked_by) || countOf(node.edge_media_preview_like),
    conversation: countOf(node.edge_media_to_comment),
    // Instagram exposes neither share nor save counts to anyone.
    amplification: 0,
    saves: 0,
    // Feed video nodes carry video_view_count; photos legitimately have none.
    views: num(pick(node, ['video_view_count', 'video_play_count'])),
    raw: node,
  };
}

export async function fetchFeedPosts(
  userId: string,
  token: string,
  opts: { since: Date; until: Date; depth: number; onApiCall?: () => void; signal?: AbortSignal },
): Promise<NormalizedPost[]> {
  const body = await ensembleGet('/instagram/user/posts', {
    user_id: userId,
    depth: opts.depth,
    oldest_timestamp: Math.floor(opts.since.getTime() / 1000),
    chunk_size: 10,
  }, { token, platform: PLATFORM, onApiCall: opts.onApiCall, signal: opts.signal });

  const data = envelope<Record<string, unknown>>(body) ?? {};
  const rows = Array.isArray(data.posts) ? data.posts : [];

  const out: NormalizedPost[] = [];
  for (const row of rows) {
    if (!isRecord(row)) continue;
    const node = isRecord(row.node) ? row.node : row;
    const post = readFeedNode(node);
    if (!post) continue;
    if (post.postedAt < opts.since || post.postedAt > opts.until) continue;
    out.push(post);
  }
  return out;
}

/**
 * Map the observed `/instagram/user/reels` row shape.
 *
 * Reels carry playable MP4 renditions in `video_versions`, while their poster
 * candidates live under `image_versions2`. Both are signed CDN URLs, but
 * retaining them lets the existing post detail view show the current preview.
 */
export function mapInstagramEnsembleReel(
  row: Record<string, unknown>,
): NormalizedPost | undefined {
  const media = isRecord(row.media) ? row.media : row;

  const externalId = str(pick(media, ['pk', 'id']));
  const postedAt = fromUnix(pick(media, ['taken_at', 'device_timestamp']));
  if (!externalId || !postedAt) return undefined;

  const text = captionOf(media);
  const code = str(media.code);
  const durationMs = num(pick(media, ['video_duration']));
  const imageVersions = isRecord(media.image_versions2) ? media.image_versions2 : undefined;

  return {
    externalId,
    postedAt,
    // product_type clips is Instagram's own marker for a reel. Trusting it
    // rather than guessing from media type is the entire point of this call.
    type: str(media.product_type) === 'clips' ? 'reel' : 'video',
    text,
    permalink: code ? 'https://www.instagram.com/reel/' + code + '/' : null,
    mediaUrl: firstRenditionUrl(media.video_versions) ?? str(media.video_url) ?? null,
    thumbnailUrl: str(media.display_uri)
      ?? firstRenditionUrl(imageVersions?.candidates)
      ?? str(media.thumbnail_url)
      ?? null,
    durationSec: durationMs > 0 ? Math.round(durationMs > 1000 ? durationMs / 1000 : durationMs) : null,
    language: null,
    hashtags: extractHashtags(text),
    mentions: extractMentions(text),
    urls: extractUrls(text),
    applause: num(pick(media, ['like_count'])),
    conversation: num(pick(media, ['comment_count'])),
    amplification: num(pick(media, ['reshare_count'])),
    saves: 0,
    views: num(pick(media, ['play_count', 'ig_play_count', 'view_count'])),
    raw: media,
  };
}

/**
 * Reels. Different endpoint, different shape, and the only place a play count
 * exists. product_type is clips here, which is what makes reel typing reliable.
 */
export async function fetchReels(
  userId: string,
  handle: string,
  token: string,
  opts: { since: Date; until: Date; depth: number; onApiCall?: () => void; signal?: AbortSignal },
): Promise<NormalizedPost[]> {
  const body = await ensembleGet('/instagram/user/reels', {
    user_id: userId,
    depth: opts.depth,
    oldest_timestamp: Math.floor(opts.since.getTime() / 1000),
    chunk_size: 10,
  }, { token, platform: PLATFORM, onApiCall: opts.onApiCall, signal: opts.signal });

  const data = envelope<unknown>(body);
  const rows = Array.isArray(data) ? data
    : isRecord(data) && Array.isArray(data.reels) ? data.reels
      : isRecord(data) && Array.isArray(data.items) ? data.items : [];

  const out: NormalizedPost[] = [];
  for (const row of rows) {
    if (!isRecord(row)) continue;
    const post = mapInstagramEnsembleReel(row);
    if (!post) continue;
    if (post.postedAt < opts.since || post.postedAt > opts.until) continue;
    out.push(post);
  }
  return out;
}

/**
 * Feed plus reels, deduplicated.
 *
 * A reel can also appear in the feed response without its play count. When the
 * same id arrives from both, the reel wins: it is the copy that knows how many
 * times the thing was watched.
 */
export async function fetchAllPosts(
  userId: string,
  handle: string,
  token: string,
  opts: { since: Date; until: Date; limit: number; onApiCall?: () => void; signal?: AbortSignal },
): Promise<{ posts: NormalizedPost[]; warnings: string[] }> {
  const depth = Math.max(1, Math.min(Math.ceil(opts.limit / 10), 6));
  const warnings: string[] = [];

  const [feed, reels] = await Promise.all([
    fetchFeedPosts(userId, token, { ...opts, depth }).catch((e: unknown) => {
      warnings.push('Instagram feed for @' + handle + ' failed: ' + (e instanceof Error ? e.message : String(e)));
      return [] as NormalizedPost[];
    }),
    fetchReels(userId, handle, token, { ...opts, depth }).catch((e: unknown) => {
      warnings.push('Instagram reels for @' + handle + ' failed: ' + (e instanceof Error ? e.message : String(e)));
      return [] as NormalizedPost[];
    }),
  ]);

  const byId = new Map<string, NormalizedPost>();
  for (const p of feed) byId.set(p.externalId, p);
  for (const p of reels) byId.set(p.externalId, p);

  return { posts: [...byId.values()], warnings };
}
