import type { Metadata } from 'next';
import { requireOrg } from '@/lib/session';
import { getTagActivity } from '@/lib/tagging/activity';
import { TaggingLiveFeed } from '@/components/tags/tagging-live-feed';

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
  const initial = await getTagActivity(orgId);
  return <TaggingLiveFeed initial={initial} />;
}
