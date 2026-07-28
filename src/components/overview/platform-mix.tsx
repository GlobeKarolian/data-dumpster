import * as React from 'react';
import type { SummaryResult } from '@/lib/metrics/contract';
import { METRIC_DEFS } from '@/lib/metrics/definitions';
import { PLATFORM_COLORS, PLATFORM_LABELS } from '@/lib/types';
import { compactNumber, percent } from '@/lib/utils';
import { Panel } from '@/components/common/panel';
import { DonutChart } from '@/components/charts/donut-chart';
import { MetricLabel } from '@/components/ui/metric-label';

/**
 * Where the focus company's weight actually sits, and how that compares to the
 * rest of the landscape. The "vs. landscape average" column is the part that
 * matters: a channel can look dominant in your own mix and still be a channel
 * you are losing.
 */
export function PlatformMixPanel({
  summary,
  error,
}: {
  summary: SummaryResult | null;
  error?: string | null;
}) {
  const mix = summary?.platformMix ?? [];
  const metric = mix[0]?.metric ?? 'engagementTotal';
  const total = mix.reduce((sum, m) => sum + (Number.isFinite(m.focusValue) ? m.focusValue : 0), 0);

  return (
    <Panel
      title="Platform mix"
      description={
        <span>
          {'Split of the focus company’s ' + METRIC_DEFS[metric].label.toLowerCase() + ' across channels.'}
        </span>
      }
      error={error}
      note={
        summary?.topPlatform
          ? 'Strongest channel by total engagement in this window: ' +
            PLATFORM_LABELS[summary.topPlatform] + '.'
          : undefined
      }
    >
      <DonutChart
        slices={mix
          .filter((m) => m.focusValue > 0)
          .map((m) => ({
            key: m.platform,
            label: PLATFORM_LABELS[m.platform],
            value: m.focusValue,
            color: PLATFORM_COLORS[m.platform],
          }))}
        centerLabel={total > 0 ? compactNumber(total) : undefined}
        centerCaption="total"
        emptyHint="No measured activity on any channel in this window."
      />

      {mix.length > 0 ? (
        <table className="mt-4 w-full text-xs">
          <caption className="sr-only">Focus company versus landscape average, by platform</caption>
          <thead>
            <tr className="border-b border-zinc-200 text-left text-zinc-500 dark:border-zinc-800 dark:text-zinc-400">
              <th scope="col" className="py-1.5 font-medium">Channel</th>
              <th scope="col" className="py-1.5 text-right font-medium">
                <MetricLabel metric={metric} short align="end" />
              </th>
              <th scope="col" className="py-1.5 text-right font-medium">Landscape avg</th>
              <th scope="col" className="py-1.5 text-right font-medium">Index</th>
            </tr>
          </thead>
          <tbody>
            {mix.map((m) => {
              const index =
                m.competitorAverage && m.competitorAverage > 0
                  ? m.focusValue / m.competitorAverage
                  : null;
              return (
                <tr key={m.platform} className="border-b border-zinc-100 last:border-0 dark:border-zinc-800/60">
                  <td className="py-1.5 text-zinc-700 dark:text-zinc-300">{PLATFORM_LABELS[m.platform]}</td>
                  <td className="pb-num py-1.5 text-right text-zinc-900 dark:text-zinc-100">
                    {compactNumber(m.focusValue)}
                  </td>
                  <td className="pb-num py-1.5 text-right text-zinc-500">
                    {m.competitorAverage === null ? '—' : compactNumber(m.competitorAverage)}
                  </td>
                  <td
                    className={
                      'pb-num py-1.5 text-right font-medium ' +
                      (index === null
                        ? 'text-zinc-400'
                        : index >= 1
                          ? 'text-emerald-700 dark:text-emerald-400'
                          : 'text-red-700 dark:text-red-400')
                    }
                  >
                    {index === null ? '—' : percent(index - 1, 0)}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      ) : null}
    </Panel>
  );
}
