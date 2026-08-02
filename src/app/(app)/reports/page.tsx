import type { Metadata } from 'next';
import Link from 'next/link';
import { FileSpreadsheet } from 'lucide-react';
import { Card, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { EmptyState } from '@/components/ui/empty-state';
import { formatFullDate, formatRelative } from '@/components/ui/format';
import { NoLandscape } from '@/components/common/no-landscape';
import { NewReportButton } from '@/components/reports/new-report-button';
import { ScheduleManager } from '@/components/reports/schedule-manager';
import { roleAtLeast } from '@/lib/roles';
import { MANUAL_SECTIONS } from '@/lib/reports/types';
import { resolveContext } from '../_lib/context';
import { query, type SearchParamsInput } from '../_lib/data';

export const metadata: Metadata = { title: 'Weekly Reports' };

type ReportRow = {
  id: string;
  title: string;
  period_start: string;
  period_end: string;
  status: string;
  data_note: string | null;
  updated_at: string;
  computed_at: string | null;
  landscape_name: string | null;
  manual_tables: number | string;
  narrative_sections: number | string;
};

export default async function ReportsPage({
  searchParams,
}: {
  searchParams: Promise<SearchParamsInput>;
}) {
  const ctx = await resolveContext(await searchParams);
  if (!ctx.landscape) return <NoLandscape reason={ctx.error} />;

  const reports = await query<ReportRow>(({ sql }) => sql`
    SELECT r.id, r.title, r.period_start, r.period_end, r.status, r.data_note, r.updated_at,
           r.computed ->> 'generatedAt' AS computed_at,
           l.name AS landscape_name,
           CASE WHEN jsonb_typeof(r.manual -> 'tables') = 'object'
                THEN (SELECT count(*)::int FROM jsonb_object_keys(r.manual -> 'tables'))
                ELSE 0 END AS manual_tables,
           CASE WHEN jsonb_typeof(r.narrative) = 'object'
                THEN (SELECT count(*)::int FROM jsonb_object_keys(r.narrative))
                ELSE 0 END AS narrative_sections
      FROM weekly_reports r
      LEFT JOIN landscapes l ON l.id = r.landscape_id
     WHERE r.org_id = ${ctx.orgId}::uuid
     ORDER BY r.period_end DESC, r.created_at DESC
     LIMIT 60
  `);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="max-w-2xl">
          <h2 className="text-base font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
            Weekly reports
          </h2>
          <p className="mt-1 text-sm leading-relaxed text-zinc-600 dark:text-zinc-400">
            The Platforms Dashboard and Digest, built rather than retyped. Follower totals,
            engagement and the competitive ranking are computed from ingested data and stored as a
            dated snapshot; an editor can deliberately recompute that snapshot when the source data
            changes. Search Console, referral traffic,
            paid promotion and Apple News live in systems this app does not read, so they get paste
            boxes and are labelled by hand. Every section carries its own narrative.
          </p>
        </div>
        {roleAtLeast(ctx.role, 'editor') ? (
          <NewReportButton landscapeId={ctx.landscape.id} />
        ) : null}
      </div>

      <ScheduleManager
        landscapeId={ctx.landscape.id}
        canEdit={ctx.role === 'admin' || ctx.role === 'owner'}
      />

      {reports.error ? (
        <p className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700 dark:border-red-900/50 dark:bg-red-950/30 dark:text-red-400">
          {'Reports could not be listed: ' + reports.error}
        </p>
      ) : null}

      {reports.data.length === 0 ? (
        <Card>
          <EmptyState
            icon={FileSpreadsheet}
            title="No weekly reports yet"
            description="Start one for the week that just ended. The computed sections are filled in as it is created; the paste boxes are waiting for you."
          />
        </Card>
      ) : (
        <Card>
          <CardHeader>
            <CardTitle>
              {reports.data.length + (reports.data.length === 1 ? ' report' : ' reports')}
            </CardTitle>
          </CardHeader>
          <ul className="divide-y divide-zinc-100 dark:divide-zinc-800/60">
            {reports.data.map((r) => {
              const pasted = Number(r.manual_tables) || 0;
              const written = Number(r.narrative_sections) || 0;
              return (
                <li key={r.id}>
                  <Link
                    href={'/reports/' + r.id}
                    className="flex items-start gap-3 px-4 py-3 transition-colors hover:bg-zinc-50 dark:hover:bg-zinc-800/40"
                  >
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium text-zinc-900 dark:text-zinc-100">
                        {r.title}
                      </p>
                      <p className="pb-num mt-0.5 text-[11px] text-zinc-500">
                        {formatFullDate(r.period_start) + ' – ' + formatFullDate(r.period_end)
                          + (r.landscape_name ? ' · ' + r.landscape_name : '')
                          + ' · edited ' + formatRelative(r.updated_at)
                          + ' · computed ' + (r.computed_at ? formatRelative(r.computed_at) : 'never')}
                      </p>
                      <p className="pb-num mt-0.5 text-[11px] text-zinc-400 dark:text-zinc-500">
                        {pasted + ' of ' + MANUAL_SECTIONS.length + ' paste boxes filled · '
                          + written + ' narrative sections written'}
                      </p>
                    </div>
                    <div className="flex shrink-0 flex-col items-end gap-1">
                      <Badge tone={r.status === 'final' ? 'positive' : 'neutral'}>
                        {r.status === 'final' ? 'Final' : 'Draft'}
                      </Badge>
                      {r.data_note ? <Badge tone="warning">Data note</Badge> : null}
                    </div>
                  </Link>
                </li>
              );
            })}
          </ul>
        </Card>
      )}
    </div>
  );
}
