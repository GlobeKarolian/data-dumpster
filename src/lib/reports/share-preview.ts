import { readComputed } from './types';

/**
 * A report capability may fetch media only for posts frozen into that report's
 * computed snapshot. Possessing one public report token must never become a way
 * to enumerate arbitrary pooled post ids.
 */
export function sharedReportContainsPost(computedValue: unknown, postId: string): boolean {
  const computed = readComputed(computedValue);
  if (!computed) return false;

  const marketPosts = Array.isArray(computed.topPosts) ? computed.topPosts : [];
  const bgmPosts = Array.isArray(computed.bgmTopPosts) ? computed.bgmTopPosts : [];
  return [...marketPosts, ...bgmPosts].some((post) => post?.id === postId);
}
