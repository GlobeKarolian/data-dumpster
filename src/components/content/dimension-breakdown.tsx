import * as React from 'react';
import type { DimensionRow } from '@/lib/metrics/content-analysis';
import { MetricLabel } from '@/components/ui/metric-label';
import { pct } from './insight';

const FALLBACK_COLORS = [
  '#C8102E',
  '#2563EB',
  '#0D9488',
  '#D97706',
  '#7C3AED',
  '#DB2777',
  '#4F46E5',
  '#65A30D',
];

function number(value: number): string {
  return value.toLocaleString('en-US', {
    minimumFractionDigits: value > 0 && value < 1 ? 2 : 0,
    maximumFractionDigits: value < 10 ? 2 : 1,
  });
}

function linkedLabel(
  row: DimensionRow,
  labelForKey: (key: string) => string,
  hrefForKey?: (key: string) => string,
) {
  const label = labelForKey(row.key);
  if (!hrefForKey) return label;
  return (
    <a
      href={hrefForKey(row.key)}
      className="font-medium underline decoration-zinc-300 underline-offset-2 hover:text-accent-700 dark:decoration-zinc-700 dark:hover:text-accent-400"
    >
      {label}
    </a>
  );
}

function Donut({
  rows,
  colors,
  total,
  publicationLabel,
}: {
  rows: DimensionRow[];
  colors: Map<string, string>;
  total: number;
  publicationLabel: string;
}) {
  const stops = rows.reduce<{ cursor: number; values: string[] }>((state, row) => {
    const next = state.cursor + (total > 0 ? (row.focusPosts / total) * 100 : 0);
    return {
      cursor: next,
      values: [
        ...state.values,
        `${colors.get(row.key)} ${state.cursor.toFixed(2)}% ${next.toFixed(2)}%`,
      ],
    };
  }, { cursor: 0, values: [] }).values;

  return (
    <div
      className="relative mx-auto aspect-square w-32 shrink-0 rounded-full"
      style={{
        background: stops.length > 0
          ? `conic-gradient(${stops.join(', ')})`
          : 'rgb(228 228 231)',
      }}
      role="img"
      aria-label={`${total.toLocaleString('en-US')} ${publicationLabel.toLowerCase()} split across the selected company's active categories`}
    >
      <div className="absolute inset-[22%] flex flex-col items-center justify-center rounded-full bg-white text-center dark:bg-zinc-900">
        <span className="pb-num text-lg font-semibold tabular-nums text-zinc-900 dark:text-zinc-100">
          {total.toLocaleString('en-US')}
        </span>
        <span className="text-[10px] uppercase tracking-wide text-zinc-500">
          {publicationLabel}
        </span>
      </div>
    </div>
  );
}

export function DimensionBreakdown({
  rows,
  focusName,
  publicationLabel,
  rateLabel,
  performanceMetric = 'engagementRateByFollower',
  days,
  companyCount,
  leftTitle,
  rightTitle,
  hrefForKey,
  labelForKey = (key) => key,
  colorForKey,
}: {
  rows: DimensionRow[];
  focusName: string;
  publicationLabel: string;
  rateLabel: string;
  performanceMetric?: 'engagementRateByFollower' | 'engagementPerPost';
  days: number;
  companyCount: number;
  leftTitle: string;
  rightTitle: string;
  hrefForKey?: (key: string) => string;
  labelForKey?: (key: string) => string;
  colorForKey?: (key: string, index: number) => string | undefined;
}) {
  const activeRows = [...rows]
    .filter((row) => row.focusPosts > 0)
    .sort((a, b) => b.focusPosts - a.focusPosts || a.key.localeCompare(b.key));
  const performanceValue = (row: DimensionRow) => row[performanceMetric];
  const formatPerformance = (value: number) => performanceMetric === 'engagementPerPost'
    ? number(value)
    : pct(value);
  const marketRows = [...rows]
    .sort((a, b) =>
      performanceValue(b) - performanceValue(a)
      || b.posts - a.posts
      || a.key.localeCompare(b.key));
  const colors = new Map<string, string>(
    rows.map((row, index): [string, string] => [
      row.key,
      colorForKey?.(row.key, index) ?? FALLBACK_COLORS[index % FALLBACK_COLORS.length],
    ]),
  );
  const focusTotal = activeRows.reduce((sum, row) => sum + row.focusPosts, 0);
  const safeDays = Math.max(1, days);
  const safeCompanyCount = Math.max(1, companyCount);
  const maxMarketRate = Math.max(
    0.000001,
    ...marketRows.map(performanceValue),
  );

  return (
    <div className="grid divide-y divide-zinc-200 lg:grid-cols-2 lg:divide-x lg:divide-y-0 dark:divide-zinc-800">
      <section className="min-w-0 p-4" aria-label={leftTitle}>
        <div className="mb-4">
          <h3 className="text-[11px] font-semibold uppercase tracking-wide text-zinc-600 dark:text-zinc-300">
            {leftTitle}
          </h3>
          <p className="mt-1 text-[11px] text-zinc-500 dark:text-zinc-400">
            {focusName} · <MetricLabel metric="postsPerDay" text={`${publicationLabel} per day`} />
          </p>
        </div>

        {activeRows.length === 0 ? (
          <p className="py-12 text-center text-xs text-zinc-500">
            No activity for the selected company in this window.
          </p>
        ) : (
          <div className="grid items-center gap-5 sm:grid-cols-[minmax(0,1fr)_8rem]">
            <div className="min-w-0 space-y-2.5">
              {activeRows.map((row) => (
                <div key={row.key} className="flex min-w-0 items-center gap-2 text-xs">
                  <span
                    className="h-2.5 w-2.5 shrink-0 rounded-sm"
                    style={{ backgroundColor: colors.get(row.key) }}
                    aria-hidden="true"
                  />
                  <span className="min-w-0 flex-1 truncate text-zinc-700 dark:text-zinc-300">
                    {linkedLabel(row, labelForKey, hrefForKey)}
                  </span>
                  <span className="pb-num shrink-0 tabular-nums font-medium text-zinc-900 dark:text-zinc-100">
                    {number(row.focusPosts / safeDays)}
                  </span>
                </div>
              ))}
            </div>
            <Donut
              rows={activeRows}
              colors={colors}
              total={focusTotal}
              publicationLabel={publicationLabel}
            />
          </div>
        )}
      </section>

      <section className="min-w-0 p-4" aria-label={rightTitle}>
        <div className="mb-4">
          <h3 className="text-[11px] font-semibold uppercase tracking-wide text-zinc-600 dark:text-zinc-300">
            {rightTitle}
          </h3>
          <div className="mt-1 grid grid-cols-[minmax(0,1fr)_7rem_7.5rem] gap-3 text-[10px] uppercase tracking-wide text-zinc-500">
            <span />
            <MetricLabel
              metric="postsPerDay"
              text={`${publicationLabel} / day / company`}
              className="justify-end"
              align="end"
            />
            <MetricLabel
              metric={performanceMetric}
              text={rateLabel}
              className="justify-end"
              align="end"
            />
          </div>
        </div>

        {marketRows.length === 0 ? (
          <p className="py-12 text-center text-xs text-zinc-500">
            No landscape activity in this window.
          </p>
        ) : (
          <div className="divide-y divide-zinc-100 dark:divide-zinc-800/60">
            {marketRows.map((row) => (
              <div
                key={row.key}
                className="grid grid-cols-[minmax(0,1fr)_7rem_7.5rem] items-center gap-3 py-2 text-xs"
              >
                <span className="flex min-w-0 items-center gap-2">
                  <span
                    className="h-2.5 w-2.5 shrink-0 rounded-sm"
                    style={{ backgroundColor: colors.get(row.key) }}
                    aria-hidden="true"
                  />
                  <span className="min-w-0 truncate text-zinc-700 dark:text-zinc-300">
                    {linkedLabel(row, labelForKey, hrefForKey)}
                  </span>
                </span>
                <span className="pb-num text-right tabular-nums text-zinc-600 dark:text-zinc-300">
                  {number(row.posts / safeDays / safeCompanyCount)}
                </span>
                <span className="flex items-center gap-2">
                  <span className="h-1.5 min-w-0 flex-1 overflow-hidden rounded-full bg-zinc-100 dark:bg-zinc-800">
                    <span
                      className="block h-full rounded-full"
                      style={{
                        backgroundColor: colors.get(row.key),
                        width: `${Math.max(
                          performanceValue(row) > 0 ? 2 : 0,
                          (performanceValue(row) / maxMarketRate) * 100,
                        )}%`,
                      }}
                    />
                  </span>
                  <span className="pb-num w-[3.25rem] shrink-0 text-right tabular-nums text-zinc-600 dark:text-zinc-300">
                    {formatPerformance(performanceValue(row))}
                  </span>
                </span>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
