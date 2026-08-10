import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { ReportPresentation } from '@/components/reports/report-presentation';
import { sanitizeReportNarrative } from '@/lib/reports/narrative-verification';
import { readComputed, readManual, readNarrative } from '@/lib/reports/types';
import type { ReportDocument } from '@/lib/reports/render';
import { query } from '../../(app)/_lib/data';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Shared weekly report',
  robots: { index: false, follow: false },
};

type SharedReportRow = {
  title: string;
  data_note: string | null;
  period_start: string;
  period_end: string;
  computed: unknown;
  manual: unknown;
  narrative: unknown;
  org_name: string;
  landscape_name: string | null;
};

/** Read-only report authorized solely by its revocable capability token. */
export default async function SharedWeeklyReportPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const result = await query<SharedReportRow>(({ sql }) => sql`
    SELECT r.title, r.data_note, r.period_start, r.period_end,
           r.computed, r.manual, r.narrative,
           o.name AS org_name, l.name AS landscape_name
      FROM weekly_reports r
      JOIN orgs o ON o.id = r.org_id
      LEFT JOIN landscapes l ON l.id = r.landscape_id
     WHERE r.share_token = ${token}
     LIMIT 1
  `);
  if (result.error) throw new Error('Shared weekly report could not load: ' + result.error);
  const row = result.data[0];
  if (!row) notFound();

  const computed = readComputed(row.computed);
  const manual = readManual(row.manual);
  const storedNarrative = readNarrative(row.narrative);
  const base: ReportDocument = {
    title: row.title,
    orgName: row.org_name,
    period: { start: row.period_start, end: row.period_end },
    dataNote: row.data_note,
    computed,
    manual,
    narrative: storedNarrative,
  };
  const { narrative } = sanitizeReportNarrative(base);

  return (
    <main className="min-h-dvh bg-zinc-100 px-3 py-4 sm:px-6 sm:py-8 dark:bg-zinc-950">
      <div className="mx-auto max-w-6xl">
        <ReportPresentation doc={{ ...base, narrative }} landscapeName={row.landscape_name} />
        <p className="mx-auto mt-4 max-w-3xl text-center text-[11px] leading-relaxed text-zinc-400">
          Read-only report published from Data Dumpster. This link can be revoked by a report editor at any time.
        </p>
      </div>
    </main>
  );
}
