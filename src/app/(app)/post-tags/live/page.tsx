import type { Metadata } from 'next';
import { TaggingLiveFeed } from '@/components/tags/tagging-live-feed';

export const metadata: Metadata = { title: 'Tagging · Live' };

/**
 * The tagging pipeline, watchable. Everything rendered here is a real settled
 * read from ai_tag_state — the feed animates arrivals, it never invents them.
 */
export default function TaggingLivePage() {
  return <TaggingLiveFeed />;
}
