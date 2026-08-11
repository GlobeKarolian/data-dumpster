'use client';

import { ExternalLink } from 'lucide-react';
import type { ReportDocument } from '@/lib/reports/render';
import { formatRelative } from '@/components/ui/format';
import {
  MANUAL_FIGURES,
  MANUAL_SECTIONS,
  periodLabel,
  type ManualSectionSpec,
} from '@/lib/reports/types';
import { reportManualRows } from '@/lib/reports/manual-rows';
import { sourceUrlFor, type SearchTableId } from '@/lib/reports/search-console-sources';
import {
  BrandScorecards,
  BrandsSection,
  CohortSection,
  PerformanceSection,
  PortfolioCharts,
  TopPostsSection,
} from './computed-panel';
import { SectionCard } from './ui';

const SEARCH_IDS = new Set(['globeSearch', 'bostonSearch']);

/**
 * The finished weekly report, separate from the editing workflow.
 *
 * This component is also used by the public capability-link page. Keeping one
 * presentation prevents a shared report from drifting away from the version
 * leadership reviewed internally.
 */
export function ReportPresentation({
  doc,
  landscapeName,
  reportShareToken,
}: {
  doc: ReportDocument;
  landscapeName: string | null;
  reportShareToken?: string;
}) {
  const searchSpecs = MANUAL_SECTIONS.filter((spec) => SEARCH_IDS.has(spec.id));
  const otherSpecs = MANUAL_SECTIONS.filter((spec) => !SEARCH_IDS.has(spec.id));
  const hasFigures = MANUAL_FIGURES.some((figure) => doc.manual.figures[figure.id]?.trim());
  const isSharedReport = reportShareToken !== undefined;
  const hasVisualBrandMetrics = Boolean(doc.computed?.brands.some((brand) =>
    brand.isBgmOwned && brand.posts !== undefined && brand.engagementTotal !== undefined));

  return (
    <article className="overflow-hidden rounded-xl border border-zinc-200 bg-white shadow-sm dark:border-zinc-800 dark:bg-zinc-950">
      <header className="border-b border-zinc-200 px-5 py-7 sm:px-8 sm:py-9 dark:border-zinc-800">
        <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-accent-600">
          Data Dumpster · Weekly Intelligence
        </p>
        <div className="mt-4 flex flex-wrap items-end justify-between gap-5">
          <div>
            <h1 className="max-w-3xl text-3xl font-semibold tracking-[-0.035em] text-zinc-950 sm:text-4xl dark:text-white">
              {doc.title}
            </h1>
            <p className="pb-num mt-2 text-sm text-zinc-500">
              {doc.orgName + ' · ' + periodLabel(doc.period) + (landscapeName ? ' · ' + landscapeName : '')}
            </p>
          </div>
          {doc.computed ? (
            <p className="pb-num text-[11px] text-zinc-400">
              {'Data computed ' + formatRelative(doc.computed.generatedAt)}
            </p>
          ) : null}
        </div>
      </header>

      <div className="space-y-6 bg-zinc-50/60 p-4 sm:p-6 lg:p-8 dark:bg-zinc-950">
        {doc.dataNote ? (
          <aside className="rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm leading-relaxed text-amber-900 dark:border-amber-900/60 dark:bg-amber-950/30 dark:text-amber-200">
            <span className="mr-2 font-semibold">Data note</span>{doc.dataNote}
          </aside>
        ) : null}

        <Narrative title="Executive readout" text={doc.narrative.executiveSummary} prominent />

        {doc.computed ? (
          <>
            <PerformanceSection
              computed={doc.computed}
              showCoverageNotes={!isSharedReport}
            />
            {hasVisualBrandMetrics ? (
              <PortfolioCharts computed={doc.computed} />
            ) : (
              <aside className="rounded-lg border border-sky-200 bg-sky-50 px-4 py-3 text-sm text-sky-900 dark:border-sky-900/60 dark:bg-sky-950/30 dark:text-sky-200">
                This saved report predates the visual brand scorecards. An editor can switch to Edit report and recompute it to add the new charts.
              </aside>
            )}
            <TopPostsSection computed={doc.computed} reportShareToken={reportShareToken} />
            {hasVisualBrandMetrics ? <BrandScorecards computed={doc.computed} /> : null}
            <BrandsSection computed={doc.computed} />
            <Narrative title="What changed across BGM brands" text={doc.narrative.brands} />
          </>
        ) : (
          <section className="rounded-lg border border-dashed border-zinc-300 bg-white px-5 py-10 text-center text-sm text-zinc-500 dark:border-zinc-800 dark:bg-zinc-900/40">
            Recompute this report to generate its performance figures.
          </section>
        )}

        <section className="space-y-3">
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-sky-700 dark:text-sky-400">Google Web Search</p>
            <h2 className="mt-1 text-xl font-semibold tracking-tight text-zinc-950 dark:text-zinc-50">
              Web searches for Globe.com and Boston.com
            </h2>
            <p className="mt-1 text-xs leading-relaxed text-zinc-500">
              Every included row, ranked by URL clicks for the report dates. Each table is sourced from Google Search Console.
            </p>
          </div>
          <div className="space-y-4">
            {searchSpecs.map((spec) => (
              <ReadOnlyTable key={spec.id} spec={spec} doc={doc} showSource />
            ))}
          </div>
          <Narrative title="What search demand tells us" text={doc.narrative.search} />
        </section>

        {otherSpecs.some((spec) => (doc.manual.tables[spec.id]?.rows.length ?? 0) > 0) ? (
          <section className="space-y-3">
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-zinc-500">Referral</p>
              <h2 className="mt-1 text-xl font-semibold tracking-tight text-zinc-950 dark:text-zinc-50">Platform referral performance</h2>
            </div>
            <div className="space-y-4">
              {otherSpecs.map((spec) => (
                <ReadOnlyTable key={spec.id} spec={spec} doc={doc} />
              ))}
            </div>
            <Narrative title="Referral interpretation" text={doc.narrative.referral} />
          </section>
        ) : null}

        {hasFigures ? <ManualFigures doc={doc} /> : null}
        {hasFigures ? <Narrative title="Paid promotion and Apple News" text={doc.narrative.paid} /> : null}

        {doc.computed ? (
          <>
            <CohortSection computed={doc.computed} />
            <Narrative title="Competitive context" text={doc.narrative.cohort} />
            {!isSharedReport && doc.computed.caveats.length > 0 ? (
              <details className="rounded-lg border border-zinc-200 bg-white px-4 py-3 dark:border-zinc-800 dark:bg-zinc-900/40">
                <summary className="cursor-pointer text-xs font-semibold text-zinc-600 dark:text-zinc-300">
                  {'Measurement notes (' + doc.computed.caveats.length + ')'}
                </summary>
                <ul className="mt-3 grid gap-2 lg:grid-cols-2">
                  {doc.computed.caveats.map((note) => (
                    <li key={note} className="text-xs leading-relaxed text-zinc-500">{note}</li>
                  ))}
                </ul>
              </details>
            ) : null}
          </>
        ) : null}
      </div>
    </article>
  );
}

function Narrative({ title, text, prominent = false }: { title: string; text?: string; prominent?: boolean }) {
  if (!text?.trim()) return null;
  return (
    <section className={prominent
      ? 'rounded-lg bg-zinc-950 px-5 py-5 text-white dark:bg-zinc-900'
      : 'rounded-lg border border-zinc-200 bg-white px-4 py-4 dark:border-zinc-800 dark:bg-zinc-900/40'}>
      <p className={prominent
        ? 'text-[10px] font-semibold uppercase tracking-[0.16em] text-zinc-400'
        : 'text-[10px] font-semibold uppercase tracking-[0.16em] text-accent-600'}>
        {title}
      </p>
      <p className={prominent
        ? 'mt-2 whitespace-pre-line text-base leading-relaxed text-zinc-100'
        : 'mt-2 whitespace-pre-line text-sm leading-relaxed text-zinc-700 dark:text-zinc-300'}>
        {text.trim()}
      </p>
    </section>
  );
}

function ReadOnlyTable({
  spec,
  doc,
  showSource = false,
}: {
  spec: ManualSectionSpec;
  doc: ReportDocument;
  showSource?: boolean;
}) {
  const table = doc.manual.tables[spec.id];
  const rows = reportManualRows(spec.id, table);
  const searchId = spec.id as SearchTableId;
  const source = showSource ? sourceUrlFor(searchId, table?.sourceUrl) : null;
  return (
    <SectionCard
      title={spec.title}
      kind={showSource ? 'synced' : 'manual'}
      description={rows.length > 0
        ? rows.length + ' ranked rows'
        : 'No data has been pulled for this report yet.'}
      actions={source ? (
        <a href={source} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-[11px] font-medium text-sky-700 hover:underline dark:text-sky-400">
          Source report<ExternalLink className="h-3 w-3" aria-hidden />
        </a>
      ) : null}
    >
      {rows.length > 0 ? (
        <div className="overflow-x-auto">
          <table className="w-full border-collapse">
            <thead className="border-b border-zinc-200 bg-zinc-50/80 dark:border-zinc-800 dark:bg-zinc-950/40">
              <tr>
                <th className="w-8 px-2 py-2 text-right text-[10px] font-medium uppercase tracking-wider text-zinc-400">#</th>
                {spec.columns.map((column) => (
                  <th key={column.key} className={(column.numeric ? 'text-right ' : 'text-left ') + 'px-2 py-2 text-[10px] font-medium uppercase tracking-wider text-zinc-500'}>
                    {column.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800/70">
              {rows.map((row, rowIndex) => (
                <tr key={rowIndex}>
                  <td className="pb-num px-2 py-2 text-right text-[10px] text-zinc-400">{rowIndex + 1}</td>
                  {spec.columns.map((column, columnIndex) => (
                    <td key={column.key} className={(column.numeric ? 'pb-num text-right ' : 'text-left ') + 'px-2 py-2 text-xs text-zinc-700 dark:text-zinc-300'}>
                      {row[columnIndex] || '—'}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="px-4 py-8 text-center text-xs text-zinc-500">Pull the report dates in Edit mode to populate this table.</p>
      )}
    </SectionCard>
  );
}

function ManualFigures({ doc }: { doc: ReportDocument }) {
  return (
    <section className="rounded-lg border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900/40">
      <header className="border-b border-zinc-200 px-4 py-3 dark:border-zinc-800">
        <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">Paid promotion and Apple News</h2>
      </header>
      <div className="grid grid-cols-2 gap-x-6 gap-y-5 p-4 md:grid-cols-3">
        {MANUAL_FIGURES.map((figure) => {
          const value = doc.manual.figures[figure.id]?.trim();
          if (!value) return null;
          return (
            <div key={figure.id}>
              <p className="text-[10px] font-medium uppercase tracking-wider text-zinc-500">{figure.label}</p>
              <p className="pb-num mt-1 text-xl font-semibold text-zinc-900 dark:text-zinc-50">{value}</p>
            </div>
          );
        })}
      </div>
    </section>
  );
}
