import * as React from 'react';
import { Info } from 'lucide-react';
import type { SummaryResult } from '@/lib/metrics/contract';
import type { MetricKey } from '@/lib/types';
import { StatTile } from '@/components/ui/stat-tile';
import { formatFullDate } from '@/components/ui/format';

const ORDER: MetricKey[] = ['audience', 'posts', 'engagementTotal', 'engagementRateByFollower'];

export interface GlanceRowProps {
  summary: SummaryResult | null;
  color?: string;
  labels?: Partial<Record<MetricKey, string>>;
}

/**
 * The four numbers a newsroom leader actually asks for, in the order they ask:
 * how many people can we reach, how much did we publish, how much did it move,
 * and — the only one that survives a size difference — what share of the
 * audience reacted to a typical post.
 */
export function GlanceRow({ summary, color, labels }: GlanceRowProps) {
  if (!summary) {
    return (
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {ORDER.map((metric) => (
          <StatTile
            key={metric}
            metric={metric}
            label={labels?.[metric]}
            value={null}
            changePct={null}
          />
        ))}
      </div>
    );
  }

  const headline = summary.headline;
  const tiles: { metric: MetricKey; stat: SummaryResult['headline']['audience'] }[] = [
    { metric: 'audience', stat: headline.audience },
    { metric: 'posts', stat: headline.posts },
    { metric: 'engagementTotal', stat: headline.engagementTotal },
    { metric: 'engagementRateByFollower', stat: headline.engagementRateByFollower },
  ];

  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
      {tiles.map(({ metric, stat }) => (
        <StatTile
          key={metric}
          metric={metric}
          value={stat.available ? stat.value : null}
          previousValue={stat.previousAvailable ? stat.previousValue : null}
          changePct={stat.changePct}
          spark={stat.spark}
          color={color}
          label={labels?.[metric]}
          footnote={
            metric === 'audience'
              ? 'Snapshot as of ' + formatFullDate(summary.range.end)
              : undefined
          }
        />
      ))}
    </div>
  );
}

/** The comparison-window note that sits under every glance row. */
export function ComparisonNote({ summary }: { summary: SummaryResult | null }) {
  if (!summary) return null;
  return (
    <p className="mt-2 flex items-start gap-1.5 text-[11px] leading-relaxed text-zinc-500 dark:text-zinc-500">
      <Info className="mt-px h-3 w-3 shrink-0" aria-hidden />
      <span>
        {'Every change compares ' +
          formatFullDate(summary.range.start) +
          ' – ' +
          formatFullDate(summary.range.end) +
          ' against the equal-length window immediately before it (' +
          formatFullDate(summary.previousRange.start) +
          ' – ' +
          formatFullDate(summary.previousRange.end) +
          ').'}
      </span>
    </p>
  );
}
