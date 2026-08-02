import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ArrowRight } from 'lucide-react';
import { ReportBuilder } from '@/components/reports/report-builder';
import { sanitizeReportNarrative } from '@/lib/reports/narrative-verification';
import { readComputed, readManual, readNarrative } from '@/lib/reports/types';
import { query } from '../../_lib/data';

export const metadata: Metadata = { title: 'Weekly Report' };
export const dynamic = 'force-dynamic';

type ReportRow = {
  id: string;
  title: string;
  data_note: string | null;
  status: string;
  period_start: string;
  period_end: string;
  computed: unknown;
  manual: unknown;
  narrative: unknown;
  landscape_name: string | null;
  org_name: string;
};

/**
 * The builder screen.
 *
 * The row is read here rather than fetched by the client so the first paint is
 * the real document, not a spinner over an empty shell. Everything after that
 * is client state: this is an editor, and an editor that re-fetches on every
 * keystroke is an editor nobody uses.
 */
export default async function WeeklyReportPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { requireOrg, hasRole } = await import('@/lib/session');
  const session = await requireOrg();

  const result = await query<ReportRow>(({ sql }) => sql`
    SELECT r.id, r.title, r.data_note, r.status, r.period_start, r.period_end,
           r.computed, r.manual, r.narrative,
           l.name AS landscape_name,
           o.name AS org_name
      FROM weekly_reports r
      JOIN orgs o ON o.id = r.org_id
      LEFT JOIN landscapes l ON l.id = r.landscape_id
     WHERE r.id = ${id}::uuid
       AND r.org_id = ${session.orgId}::uuid
     LIMIT 1
  `);

  const report = result.data[0];
  if (!report) notFound();
  const computed = readComputed(report.computed);
  const manual = readManual(report.manual);
  const storedNarrative = readNarrative(report.narrative);
  const { narrative } = sanitizeReportNarrative({
    title: report.title,
    orgName: report.org_name,
    period: { start: report.period_start, end: report.period_end },
    dataNote: report.data_note,
    computed,
    manual,
    narrative: storedNarrative,
  });

  return (
    <div className="mx-auto max-w-6xl">
      <Link
        href="/reports"
        className="inline-flex items-center gap-1 text-xs text-zinc-500 transition-colors hover:text-zinc-900 dark:hover:text-zinc-100"
      >
        <ArrowRight className="h-3 w-3 rotate-180" aria-hidden />
        All weekly reports
      </Link>

      <div className="mt-3">
        <ReportBuilder
          reportId={report.id}
          orgName={report.org_name}
          landscapeName={report.landscape_name}
          canEdit={hasRole(session.role, 'editor')}
          initial={{
            title: report.title,
            dataNote: report.data_note,
            status: report.status,
            periodStart: report.period_start,
            periodEnd: report.period_end,
            computed,
            manual,
            narrative,
          }}
        />
      </div>
    </div>
  );
}
