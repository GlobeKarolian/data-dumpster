import type { Metadata } from 'next';
import { requireOrg } from '@/lib/session';
import { getTagActivity, getTagProgress } from '@/lib/tagging/activity';
import { TaggingLiveFeed } from '@/components/tags/tagging-live-feed';
import { TaggingProgress } from '@/components/tags/tagging-progress';

export const metadata: Metadata = { title: 'Tagging · Live' };
export const dynamic = 'force-dynamic';

/**
 * The tagging pipeline, watchable. The first paint carries real numbers from
 * the server — a session where client JavaScript fails still sees the truth —
 * and the client feed animates updates on top. Everything rendered is a
 * settled read from ai_tag_state; the feed never invents an arrival.
 */
export default async function TaggingLivePage() {
  const { orgId } = await requireOrg();
  const [initial, progress] = await Promise.all([
    getTagActivity(orgId),
    getTagProgress(orgId),
  ]);
  return (
    <div className="space-y-6">
      <TaggingProgress progress={progress} />
      <TaggingLiveFeed initial={initial} />
    </div>
  );
}
