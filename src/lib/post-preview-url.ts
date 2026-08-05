import type { Platform, PostType } from '@/lib/types';

interface PostPreviewRef {
  id: string;
  platform: Platform;
  type: PostType;
  permalink: string | null;
  thumbnailUrl: string | null;
}

const MOTION_TYPES = new Set<PostType>(['video', 'reel', 'short', 'live']);

/**
 * Instagram and TikTok both issue signed, expiring media URLs. Browser-facing
 * posters therefore go through the authenticated post-id proxy, which can
 * resolve a fresh public preview without exposing an arbitrary URL parameter.
 */
export function postPosterUrl(post: PostPreviewRef): string | null {
  if (
    (post.platform === 'instagram' || post.platform === 'tiktok' || post.platform === 'threads')
    && (post.thumbnailUrl || post.permalink)
  ) {
    return '/api/posts/' + encodeURIComponent(post.id) + '/preview';
  }
  return post.thumbnailUrl;
}

/**
 * Existing Instagram reel rows keep playable renditions in their raw payload
 * even when the normalized media URL is blank. The proxy resolves that source
 * server-side and supports byte ranges for the native video element.
 */
export function postVideoUrl(
  post: Pick<PostPreviewRef, 'id' | 'platform' | 'type'>,
  storedMediaUrl: string | null,
): string | null {
  if (
    (post.platform === 'instagram' || post.platform === 'threads')
    && MOTION_TYPES.has(post.type)
  ) {
    return '/api/posts/' + encodeURIComponent(post.id) + '/preview?kind=video';
  }
  return storedMediaUrl;
}
