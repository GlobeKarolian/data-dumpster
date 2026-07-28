import * as React from 'react';
import type { MetricKey } from '@/lib/types';
import { cn } from '@/lib/utils';
import { SparkLine, type SparkPoint } from '@/components/charts/spark-line';
import { DeltaBadge } from './delta-badge';
import { formatMetric } from './format';
import { MetricLabel } from './metric-label';

export interface StatTileProps {
  metric: MetricKey;
  value: number | null | undefined;
  previousValue?: number | null;
  changePct?: number | null;
  spark?: SparkPoint[];
  /** Overrides the metric's own label, e.g. to scope it to one platform. */
  label?: string;
  /** Small note under the value, e.g. the denominator used. */
  footnote?: React.ReactNode;
  color?: string;
  className?: string;
}

/**
 * The stat tile that opens every overview screen.
 *
 * Three things, always in the same order: the metric name with its definition,
 * the number, and how it moved against the immediately preceding window of
 * equal length. The sparkline sits under all of it because a delta alone cannot
 * distinguish steady growth from a single viral day.
 */
export function StatTile({
  metric,
  value,
  previousValue,
  changePct,
  spark,
  label,
  footnote,
  color,
  className,
}: StatTileProps) {
  return (
    <div
      className={cn(
        'flex flex-col rounded-lg border border-zinc-200 bg-white p-4',
        'dark:border-zinc-800 dark:bg-zinc-900/40',
        className,
      )}
    >
      <div className="text-xs font-medium text-zinc-500 dark:text-zinc-400">
        <MetricLabel metric={metric} text={label} side="bottom" align="start" />
      </div>

      <div className="mt-2 flex items-baseline gap-2">
        <span className="pb-num text-2xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
          {formatMetric(value, metric)}
        </span>
        <DeltaBadge
          changePct={changePct}
          previousLabel={
            previousValue === null || previousValue === undefined
              ? undefined
              : formatMetric(previousValue, metric, 'full')
          }
        />
      </div>

      {footnote ? (
        <p className="mt-1 text-[11px] leading-relaxed text-zinc-500 dark:text-zinc-500">{footnote}</p>
      ) : null}

      <div className="mt-3 flex-1">
        {spark && spark.length > 0 ? (
          <SparkLine data={spark} color={color} height={40} />
        ) : (
          <div className="flex h-10 items-center" aria-hidden>
            <div className="h-px w-full bg-zinc-200 dark:bg-zinc-800" />
          </div>
        )}
      </div>
    </div>
  );
}

/** Compact version for dashboards and share pages, without the sparkline. */
export function MiniStat({
  metric,
  value,
  changePct,
  label,
  className,
}: {
  metric: MetricKey;
  value: number | null | undefined;
  changePct?: number | null;
  label?: string;
  className?: string;
}) {
  return (
    <div className={cn('min-w-0', className)}>
      <div className="truncate text-[11px] font-medium text-zinc-500 dark:text-zinc-400">
        <MetricLabel metric={metric} text={label} short side="bottom" align="start" />
      </div>
      <div className="mt-0.5 flex items-baseline gap-1.5">
        <span className="pb-num text-lg font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
          {formatMetric(value, metric)}
        </span>
        {changePct === undefined ? null : <DeltaBadge changePct={changePct} />}
      </div>
    </div>
  );
}
