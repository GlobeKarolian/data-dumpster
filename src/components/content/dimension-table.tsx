import * as React from 'react';
import type { DimensionRow } from '@/lib/metrics/content-analysis';
import { cn } from '@/lib/utils';
import { pct } from './insight';

/**
 * The table shape that repeats across topics, hashtags, formats and channels.
 *
 * Four columns and a bar, because the comparison is the product: how many
 * companies used this, how many posts, what rate it earned, and whether you
 * were among them. The last column is the one an editor acts on.
 */
export function DimensionTable({
  rows,
  keyLabel,
  countLabel = 'Outlets',
  focusName,
}: {
  rows: DimensionRow[];
  keyLabel: string;
  countLabel?: string;
  focusName: string | null;
}) {
  const maxRate = rows.reduce((m, r) => Math.max(m, r.engagementRateByFollower), 0) || 1;

  if (rows.length === 0) {
    return (
      <p className="px-4 py-6 text-center text-xs text-zinc-500 dark:text-zinc-400">
        Not enough posts in this window to compare.
      </p>
    );
  }

  return (
    <table className="w-full text-xs">
      <thead>
        <tr className="text-[11px] text-zinc-500 dark:text-zinc-400">
          <th scope="col" className="px-4 py-2 text-left font-normal">{keyLabel}</th>
          <th scope="col" className="px-2 py-2 text-right font-normal">{countLabel}</th>
          <th scope="col" className="px-2 py-2 text-right font-normal">Posts</th>
          <th scope="col" className="px-2 py-2 text-left font-normal">Eng. rate by follower</th>
          <th scope="col" className="px-4 py-2 text-right font-normal">
            {focusName ? 'Yours' : ''}
          </th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <tr key={r.key} className="border-t border-zinc-100 dark:border-zinc-800/60">
            <td className="max-w-[11rem] truncate px-4 py-2 text-zinc-900 dark:text-zinc-100">
              {r.key}
            </td>
            <td className="pb-num px-2 py-2 text-right tabular-nums text-zinc-500">
              <span className="inline-flex min-w-[1.75rem] justify-center rounded bg-zinc-100 px-1.5 py-0.5 text-[11px] dark:bg-zinc-800">
                {r.companies}
              </span>
            </td>
            <td className="pb-num px-2 py-2 text-right tabular-nums text-zinc-500">
              {r.posts.toLocaleString('en-US')}
            </td>
            <td className="px-2 py-2">
              <span className="flex items-center gap-2">
                <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-zinc-100 dark:bg-zinc-800">
                  <span
                    className="block h-full rounded-full bg-zinc-400 dark:bg-zinc-500"
                    style={{ width: Math.max(2, (r.engagementRateByFollower / maxRate) * 100) + '%' }}
                  />
                </span>
                <span className="pb-num w-12 shrink-0 text-right tabular-nums text-zinc-600 dark:text-zinc-300">
                  {pct(r.engagementRateByFollower)}
                </span>
              </span>
            </td>
            <td
              className={cn(
                'pb-num px-4 py-2 text-right tabular-nums',
                r.focusUsed ? 'text-zinc-900 dark:text-zinc-100' : 'text-zinc-300 dark:text-zinc-600',
              )}
            >
              {r.focusUsed ? r.focusPosts.toLocaleString('en-US') : 'none'}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
