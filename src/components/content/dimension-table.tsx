import * as React from 'react';
import type { DimensionRow } from '@/lib/metrics/content-analysis';
import { MetricLabel } from '@/components/ui/metric-label';
import { pct } from './insight';

/**
 * Rival IQ's dense topic/hashtag table, restyled with Data Dumpster tokens.
 * Focus-company presence is encoded in the key marker and the legend so the
 * metric columns stay directly comparable.
 */
export function DimensionTable({
  rows,
  keyLabel,
  countLabel = 'Companies posting',
  focusName,
  publicationLabel = 'Posts',
  rateLabel = 'Eng. rate by follower',
  performanceMetric = 'engagementRateByFollower',
  hrefForKey,
  labelForKey = (key) => key,
  usedLabel = `${keyLabel}s in your ${publicationLabel.toLowerCase()}`,
  unusedLabel = `${keyLabel}s not in your ${publicationLabel.toLowerCase()}`,
}: {
  rows: DimensionRow[];
  keyLabel: string;
  countLabel?: string;
  focusName: string | null;
  publicationLabel?: string;
  rateLabel?: string;
  performanceMetric?: 'engagementRateByFollower' | 'engagementPerPost';
  hrefForKey?: (key: string) => string;
  labelForKey?: (key: string) => string;
  usedLabel?: string;
  unusedLabel?: string;
}) {
  const performanceValue = (row: DimensionRow) => row[performanceMetric];
  const formatPerformance = (value: number) => performanceMetric === 'engagementPerPost'
    ? value.toLocaleString('en-US', { maximumFractionDigits: value < 10 ? 1 : 0 })
    : pct(value);
  const maxRate = Math.max(
    0.000001,
    ...rows.map(performanceValue),
  );

  if (rows.length === 0) {
    return (
      <p className="px-4 py-8 text-center text-xs text-zinc-500 dark:text-zinc-400">
        {`Not enough ${publicationLabel.toLowerCase()} in this window to compare.`}
      </p>
    );
  }

  return (
    <div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[34rem] text-xs">
          <thead>
            <tr className="text-[10px] uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
              <th scope="col" className="px-4 py-2 text-left font-normal">{keyLabel}</th>
              <th scope="col" className="px-2 py-2 text-right font-normal">{countLabel}</th>
              <th scope="col" className="px-2 py-2 text-right font-normal">
                <MetricLabel metric="posts" text={publicationLabel} align="end" />
              </th>
              <th scope="col" className="px-4 py-2 text-left font-normal">
                <MetricLabel metric={performanceMetric} text={rateLabel} />
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              const label = labelForKey(row.key);
              return (
                <tr key={row.key} className="border-t border-zinc-100 dark:border-zinc-800/60">
                  <td className="max-w-[13rem] px-4 py-2 text-zinc-900 dark:text-zinc-100">
                    <span className="flex min-w-0 items-center gap-2">
                      <span
                        className={
                          row.focusUsed
                            ? 'h-2.5 w-2.5 shrink-0 rounded-sm bg-accent-600'
                            : 'h-2.5 w-2.5 shrink-0 rounded-sm border border-zinc-300 bg-white dark:border-zinc-600 dark:bg-zinc-900'
                        }
                        aria-hidden="true"
                      />
                      <span className="min-w-0 truncate">
                        {hrefForKey ? (
                          <a
                            href={hrefForKey(row.key)}
                            className="font-medium underline decoration-zinc-300 underline-offset-2 hover:text-accent-700 dark:decoration-zinc-700 dark:hover:text-accent-400"
                          >
                            {label}
                          </a>
                        ) : label}
                      </span>
                    </span>
                  </td>
                  <td className="pb-num px-2 py-2 text-right tabular-nums text-zinc-500">
                    <span className="inline-flex min-w-8 justify-center rounded bg-accent-50 px-1.5 py-0.5 text-[11px] text-accent-700 dark:bg-accent-950/30 dark:text-accent-400">
                      {row.companies}
                    </span>
                  </td>
                  <td className="pb-num px-2 py-2 text-right tabular-nums text-zinc-500">
                    {row.posts.toLocaleString('en-US')}
                  </td>
                  <td className="px-4 py-2">
                    <span className="flex min-w-32 items-center gap-2">
                      <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-zinc-100 dark:bg-zinc-800">
                        <span
                          className="block h-full rounded-full bg-zinc-400 dark:bg-zinc-500"
                          style={{
                            width: `${Math.max(
                              performanceValue(row) > 0 ? 2 : 0,
                              (performanceValue(row) / maxRate) * 100,
                            )}%`,
                          }}
                        />
                      </span>
                      <span className="pb-num w-14 shrink-0 text-right tabular-nums text-zinc-600 dark:text-zinc-300">
                        {formatPerformance(performanceValue(row))}
                      </span>
                    </span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <div
        className="flex flex-wrap items-center gap-x-5 gap-y-1 border-t border-zinc-200 px-4 py-2 text-[10px] text-zinc-500 dark:border-zinc-800 dark:text-zinc-400"
        aria-label={`Legend for ${focusName ?? 'the selected company'}`}
      >
        <span className="inline-flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-sm bg-accent-600" aria-hidden="true" />
          {usedLabel}
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span
            className="h-2.5 w-2.5 rounded-sm border border-zinc-300 bg-white dark:border-zinc-600 dark:bg-zinc-900"
            aria-hidden="true"
          />
          {unusedLabel}
        </span>
      </div>
    </div>
  );
}
