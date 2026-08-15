import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { ElectionRaceWorkspace } from '@/components/elections/election-race-workspace';
import { getElectionRaceAnalytics, getElectionRaceBySlug } from '@/lib/elections/queries';
import { canTriggerManualRefresh } from '@/lib/manual-refresh-policy';
import { hasRole, requireOrg } from '@/lib/session';

export const metadata: Metadata = { title: 'Race Tracker — Election Center' };
export const dynamic = 'force-dynamic';

export default async function ElectionRacePage({ params }: { params: Promise<{ slug: string }> }) {
  const session = await requireOrg();
  const { slug } = await params;
  const race = await getElectionRaceBySlug(slug, session);
  if (!race) notFound();
  const analytics = await getElectionRaceAnalytics(race, session);
  return <ElectionRaceWorkspace race={race} analytics={analytics} canEdit={hasRole(session.role, 'editor')} manualRefreshAllowed={canTriggerManualRefresh(session.email)} />;
}
