import * as React from 'react';
import { Gauge } from 'lucide-react';
import { compactNumber, percent } from '@/lib/utils';
import { Card, CardHeader, CardTitle } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { formatUsd } from '@/components/ui/format';

export interface UsageRow {
  feature: string;
  calls: number;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
  failures: number;
}

const FEATURE_LABELS: Record<string, string> = {
  brief: 'Briefs',
  ask: 'Ask',
  tagging: 'AI tagging',
  test: 'Connection tests',
  alert: 'Alert summaries',
};

function featureLabel(feature: string): string {
  return FEATURE_LABELS[feature] ?? feature.charAt(0).toUpperCase() + feature.slice(1);
}

/**
 * Spend, in dollars, for the current calendar month.
 *
 * This exists because "bring your own model" is only a real promise if the
 * org can see what it is spending. A number that lives on somebody else's
 * invoice is not a number a newsroom controls.
 */
export function UsagePanel({ rows, monthLabel }: { rows: UsageRow[]; monthLabel: string }) {
  const total = rows.reduce(
    (acc, r) => ({
      calls: acc.calls + r.calls,
      inputTokens: acc.inputTokens + r.inputTokens,
      outputTokens: acc.outputTokens + r.outputTokens,
      costUsd: acc.costUsd + r.costUsd,
      failures: acc.failures + r.failures,
    }),
    { calls: 0, inputTokens: 0, outputTokens: 0, costUsd: 0, failures: 0 },
  );

  return (
    <Card>
      <CardHeader>
        <div>
          <CardTitle>Usage and cost</CardTitle>
          <p className="mt-0.5 text-xs text-zinc-500 dark:text-zinc-400">
            {monthLabel + '. Computed from the per-token prices on each connection, so it matches your provider invoice rather than approximating it.'}
          </p>
        </div>
        <div className="text-right">
          <p className="pb-num text-xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
            {formatUsd(total.costUsd)}
          </p>
          <p className="text-[10px] uppercase tracking-wider text-zinc-400">this month</p>
        </div>
      </CardHeader>

      {rows.length === 0 ? (
        <EmptyState
          compact
          icon={Gauge}
          title="No model calls yet this month"
          description="Generate a brief or ask a question and this panel starts filling in. Nothing is estimated here; every row is a recorded call."
        />
      ) : (
        <>
          <table className="w-full text-xs">
            <caption className="sr-only">Model usage by feature</caption>
            <thead>
              <tr className="border-b border-zinc-200 text-left text-zinc-500 dark:border-zinc-800 dark:text-zinc-400">
                <th scope="col" className="px-4 py-2 font-medium">Feature</th>
                <th scope="col" className="px-2 py-2 text-right font-medium">Calls</th>
                <th scope="col" className="px-2 py-2 text-right font-medium">Input</th>
                <th scope="col" className="px-2 py-2 text-right font-medium">Output</th>
                <th scope="col" className="px-4 py-2 text-right font-medium">Cost</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.feature} className="border-b border-zinc-100 last:border-0 dark:border-zinc-800/60">
                  <td className="px-4 py-2 text-zinc-700 dark:text-zinc-300">
                    {featureLabel(r.feature)}
                    {r.failures > 0 ? (
                      <span className="pb-num ml-2 text-[10px] text-red-600 dark:text-red-400">
                        {r.failures + ' failed'}
                      </span>
                    ) : null}
                  </td>
                  <td className="pb-num px-2 py-2 text-right text-zinc-600 dark:text-zinc-400">{r.calls}</td>
                  <td className="pb-num px-2 py-2 text-right text-zinc-600 dark:text-zinc-400">
                    {compactNumber(r.inputTokens)}
                  </td>
                  <td className="pb-num px-2 py-2 text-right text-zinc-600 dark:text-zinc-400">
                    {compactNumber(r.outputTokens)}
                  </td>
                  <td className="pb-num px-4 py-2 text-right font-medium text-zinc-900 dark:text-zinc-100">
                    {formatUsd(r.costUsd)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          <div className="border-t border-zinc-200 px-4 py-3 dark:border-zinc-800">
            <div className="flex h-1.5 overflow-hidden rounded-full bg-zinc-100 dark:bg-zinc-800">
              {rows
                .filter((r) => r.costUsd > 0)
                .map((r, i) => (
                  <div
                    key={r.feature}
                    title={featureLabel(r.feature)}
                    style={{
                      width: percent(total.costUsd > 0 ? r.costUsd / total.costUsd : 0, 2),
                      backgroundColor: ['#C8102E', '#2563EB', '#0D9488', '#D97706', '#7C3AED'][i % 5],
                    }}
                  />
                ))}
            </div>
            <p className="pb-num mt-2 text-[11px] text-zinc-500">
              {compactNumber(total.inputTokens) +
                ' input and ' +
                compactNumber(total.outputTokens) +
                ' output tokens across ' +
                total.calls +
                (total.calls === 1 ? ' call' : ' calls') +
                '.'}
            </p>
          </div>
        </>
      )}
    </Card>
  );
}
