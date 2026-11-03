import type { Metadata } from 'next';
import { Panel } from '@/components/common/panel';
import { BugInbox } from '@/components/bugs/bug-inbox';
import { roleAtLeast } from '@/lib/roles';
import { listBugReports } from '@/lib/bugs/store';
import { resolveContext } from '../../_lib/context';
import { type SearchParamsInput } from '../../_lib/data';

export const metadata: Metadata = { title: 'Bug reports' };
export const dynamic = 'force-dynamic';

export default async function BugReportsPage({
  searchParams,
}: {
  searchParams: Promise<SearchParamsInput>;
}) {
  const params = await searchParams;
  const ctx = await resolveContext(params);
  if (!roleAtLeast(ctx.role, 'admin')) {
    return (
      <Panel title="Bug reports are admin-only">
        <p className="px-1 py-2 text-sm text-zinc-600 dark:text-zinc-400">
          Use “Report a bug” in the sidebar to send one. Admins see the full list here.
        </p>
      </Panel>
    );
  }
  const reports = await listBugReports(ctx.orgId, { limit: 200 });
  const selected = typeof params.id === 'string' ? params.id : null;
  return <BugInbox initial={reports} initialSelectedId={selected} />;
}
