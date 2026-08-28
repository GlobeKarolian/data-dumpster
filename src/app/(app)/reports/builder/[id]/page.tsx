import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { ArrowRight } from 'lucide-react';
import { NoLandscape } from '@/components/common/no-landscape';
import { BlockReportBuilder } from '@/components/reports/block-report-builder';
import { parseBlocks } from '@/lib/blocks/definitions';
import { formatFullDate } from '@/components/ui/format';
import { roleAtLeast } from '@/lib/roles';
import { toDayString } from '@/lib/dates';
import { resolveContext } from '../../../_lib/context';
import { query, type SearchParamsInput } from '../../../_lib/data';

export const metadata: Metadata = { title: 'Report Builder' };

type ReportRow = {
  id: string;
  name: string;
  blocks: unknown;
  landscape_id: string | null;
};

/**
 * The report builder.
 *
 * A report is an ordered list of blocks over one landscape and window. The
 * builder edits that list against a live preview that renders each block
 * through the same metrics layer the scheduled export uses, so the report the
 * editor assembles is the report the recipient opens.
 */
export default async function ReportBuilderPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<SearchParamsInput>;
}) {
  const [{ id }, resolvedSearch] = await Promise.all([params, searchParams]);
  const ctx = await resolveContext(resolvedSearch);

  const result = await query<ReportRow>(({ sql }) => sql`
    SELECT id, name, blocks, landscape_id
      FROM report_documents
     WHERE id = ${id}::uuid
       AND org_id = ${ctx.orgId}::uuid
     LIMIT 1
  `);

  if (result.error) throw new Error('Report could not load: ' + result.error);
  const report = result.data[0];
  if (!report) notFound();
  if (
    report.landscape_id
    && !ctx.landscapes.some((landscape) => landscape.id === report.landscape_id)
  ) {
    notFound();
  }

  // A report pins its own landscape, exactly like a dashboard does. Align the
  // shell before rendering so the preview cannot query one landscape while the
  // top bar names another.
  if (report.landscape_id && report.landscape_id !== ctx.landscape?.id) {
    const next = new URLSearchParams(ctx.searchParams);
    next.set('landscape', report.landscape_id);
    next.delete('companies');
    redirect('/reports/builder/' + id + '?' + next.toString());
  }

  const blocks = parseBlocks(report.blocks);
  const landscape =
    ctx.landscapes.find((l) => l.id === report.landscape_id) ?? ctx.landscape ?? null;

  if (!landscape) return <NoLandscape reason={ctx.error} />;
  if (!roleAtLeast(ctx.role, 'editor')) {
    return <NoLandscape reason="You need the editor role to build reports." />;
  }

  return (
    <div className="mx-auto max-w-7xl">
      <Link
        href="/reports"
        className="inline-flex items-center gap-1 text-xs text-zinc-500 transition-colors hover:text-zinc-900 dark:hover:text-zinc-100"
      >
        <ArrowRight className="h-3 w-3 rotate-180" aria-hidden />
        All reports
      </Link>

      <div className="mb-4 mt-3">
        <h2 className="text-base font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
          {report.name}
        </h2>
        <p className="pb-num mt-0.5 text-[11px] text-zinc-500">
          {landscape.name +
            ' · ' +
            formatFullDate(ctx.range.start) +
            ' – ' +
            formatFullDate(ctx.range.end)}
        </p>
      </div>

      <BlockReportBuilder
        reportId={report.id}
        landscapeId={landscape.id}
        start={toDayString(ctx.range.start)}
        end={toDayString(ctx.range.end)}
        blocks={blocks}
      />
    </div>
  );
}
