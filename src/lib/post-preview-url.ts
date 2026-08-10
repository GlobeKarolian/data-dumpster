import type { Platform, PostType } from '@/lib/types';

interface PostPreviewRef {
  id: string;
  platform: Platform;
  type: PostType;
  permalink: string | null;
  thumbnailUrl: string | null;
}

type PostPreviewAccess = {
  /** Revocable capability token for media embedded in a public weekly report. */
  reportShareToken?: string | null;
};

const MOTION_TYPES = new Set<PostType>(['video', 'reel', 'short', 'live']);

/**
 * Instagram and TikTok both issue signed, expiring media URLs. Browser-facing
 * posters therefore go through the access-controlled post-id proxy, which can
 * resolve a fresh public preview without exposing an arbitrary media URL.
 */
export function postPosterUrl(post: PostPreviewRef, access?: PostPreviewAccess): string | null {
  if (
    (post.platform === 'instagram' || post.platform === 'tiktok' || post.platform === 'threads')
    && (post.thumbnailUrl || post.permalink)
  ) {
    const path = '/api/posts/' + encodeURIComponent(post.id) + '/preview';
    const shareToken = access?.reportShareToken?.trim();
    return shareToken
      ? path + '?share=' + encodeURIComponent(shareToken)
      : path;
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
