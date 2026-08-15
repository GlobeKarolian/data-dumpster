import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { ElectionRaceWorkspace } from '@/components/elections/election-race-workspace';
import { getElectionRaceAnalytics, getElectionRaceBySlug } from '@/lib/elections/queries';
import { parseRangeParams } from '@/lib/dates';
import { canTriggerManualRefresh } from '@/lib/manual-refresh-policy';
import { hasRole, requireOrg } from '@/lib/session';
import { toUrlSearchParams } from '../../_lib/context';

export const metadata: Metadata = { title: 'Race Tracker — Election Center' };
export const dynamic = 'force-dynamic';

export default async function ElectionRacePage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const session = await requireOrg();
  const [{ slug }, requestedParams] = await Promise.all([params, searchParams]);
  const race = await getElectionRaceBySlug(slug, session);
  if (!race) notFound();
  const range = parseRangeParams(toUrlSearchParams(requestedParams));
  const analytics = await getElectionRaceAnalytics(race, session, range);
  return <ElectionRaceWorkspace race={race} analytics={analytics} canEdit={hasRole(session.role, 'editor')} manualRefreshAllowed={canTriggerManualRefresh(session.email)} />;
}
