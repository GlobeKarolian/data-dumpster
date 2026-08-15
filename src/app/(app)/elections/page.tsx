import type { Metadata } from 'next';
import { ElectionCenter } from '@/components/elections/election-center';
import { listElectionRaces } from '@/lib/elections/queries';
import { hasRole, requireOrg } from '@/lib/session';

export const metadata: Metadata = { title: 'Election Center' };
export const dynamic = 'force-dynamic';

export default async function ElectionCenterPage() {
  const session = await requireOrg();
  const races = await listElectionRaces(session);
  return <ElectionCenter races={races} canEdit={hasRole(session.role, 'editor')} />;
}
