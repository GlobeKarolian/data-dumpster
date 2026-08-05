import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { ArrowRight } from 'lucide-react';
import { ReportBuilder } from '@/components/reports/report-builder';
import { DeleteReportButton } from '@/components/reports/delete-report-button';
import { roleAtLeast } from '@/lib/roles';
import { sanitizeReportNarrative } from '@/lib/reports/narrative-verification';
import { reportLandscapeDestination } from '@/lib/reports/landscape-navigation';
import { readComputed, readManual, readNarrative } from '@/lib/reports/types';
import { resolveContext } from '../../_lib/context';
import { query, type SearchParamsInput } from '../../_lib/data';

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
  landscape_id: string | null;
  landscape_name: string | null;
  org_name: string;
};

type AlternateReportRow = { id: string };

/**
 * The builder screen.
 *
 * The row is read here rather than fetched by the client so the first paint is
 * the real document, not a spinner over an empty shell. Everything after that
 * is client state: this is an editor, and an editor that re-fetches on every
 * keystroke is an editor nobody uses.
 */
export default async function WeeklyReportPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<SearchParamsInput>;
}) {
  const [{ id }, resolvedSearch] = await Promise.all([params, searchParams]);
  const ctx = await resolveContext(resolvedSearch);

  const result = await query<ReportRow>(({ sql }) => sql`
    SELECT r.id, r.title, r.data_note, r.status, r.period_start, r.period_end,
           r.computed, r.manual, r.narrative, r.landscape_id,
           l.name AS landscape_name,
           o.name AS org_name
      FROM weekly_reports r
      JOIN orgs o ON o.id = r.org_id
      LEFT JOIN landscapes l ON l.id = r.landscape_id
     WHERE r.id = ${id}::uuid
       AND r.org_id = ${ctx.orgId}::uuid
     LIMIT 1
  `);

  if (result.error) throw new Error('Weekly report could not load: ' + result.error);
  const report = result.data[0];
  if (!report) notFound();

  const landscapeWasExplicit = ctx.searchParams.has('landscape');
  let alternateReportId: string | null = null;
  if (
    landscapeWasExplicit
    && report.landscape_id
    && ctx.landscape
    && report.landscape_id !== ctx.landscape.id
  ) {
    const selectedLandscapeId = ctx.landscape.id;
    const alternate = await query<AlternateReportRow>(({ sql }) => sql`
      SELECT id
        FROM weekly_reports
       WHERE org_id = ${ctx.orgId}::uuid
         AND landscape_id = ${selectedLandscapeId}::uuid
         AND period_start = ${report.period_start}::date
         AND period_end = ${report.period_end}::date
       LIMIT 1
    `);
    if (alternate.error) {
      throw new Error('The matching weekly report could not be checked: ' + alternate.error);
    }
    alternateReportId = alternate.data[0]?.id ?? null;
  }

  const destination = reportLandscapeDestination({
    reportId: report.id,
    reportLandscapeId: report.landscape_id,
    selectedLandscapeId: ctx.landscape?.id ?? null,
    landscapeWasExplicit,
    alternateReportId,
    searchParams: ctx.searchParams,
  });
  if (destination) redirect(destination);

  const reportLandscapeId = report.landscape_id ?? ctx.landscape?.id ?? null;
  const reportsHref = reportLandscapeId
    ? '/reports?landscape=' + encodeURIComponent(reportLandscapeId)
    : '/reports';
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
      <div className="flex items-center justify-between gap-3">
        <Link
          href={reportsHref}
          className="inline-flex items-center gap-1 text-xs text-zinc-500 transition-colors hover:text-zinc-900 dark:hover:text-zinc-100"
        >
          <ArrowRight className="h-3 w-3 rotate-180" aria-hidden />
          All weekly reports
        </Link>
        {roleAtLeast(ctx.role, 'editor') ? (
          <DeleteReportButton
            reportId={report.id}
            title={report.title}
            pastedTables={Object.values(manual.tables).filter((t) => t.rows.length > 0).length}
            narrativeSections={Object.values(storedNarrative).filter((v) => v.trim()).length}
            redirectTo={reportsHref}
          />
        ) : null}
      </div>

      <div className="mt-3">
        <ReportBuilder
          reportId={report.id}
          orgName={report.org_name}
          landscapeName={report.landscape_name}
          canEdit={roleAtLeast(ctx.role, 'editor')}
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
