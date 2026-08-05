import * as React from 'react';
import { METRIC_DEFS } from '@/lib/metrics/definitions';
import type { MetricKey, MetricRow } from '@/lib/types';
import { Panel } from '@/components/common/panel';
import { BarLeaderboard } from '@/components/charts/bar-leaderboard';

export interface LeaderboardPanelProps {
  metric: MetricKey;
  rows: MetricRow[];
  focusCompanyId: string | null;
  error?: string | null;
  /** Overrides the metric's own label, e.g. to scope it to one platform. */
  title?: string;
  color?: string;
  maxRows?: number;
  className?: string;
  showCompetitorAverage?: boolean;
  showPlatformBreakdown?: boolean;
}

/**
 * One metric, every company, ranked. The card header carries the definition and
 * the footer carries the caveat, so a figure that is easy to misread arrives
 * with its warning attached rather than in a footnote nobody opens.
 */
export function LeaderboardPanel({
  metric,
  rows,
  focusCompanyId,
  error,
  title,
  color,
  maxRows,
  className,
  showCompetitorAverage = true,
  showPlatformBreakdown = false,
}: LeaderboardPanelProps) {
  const def = METRIC_DEFS[metric];
  const partialRows = rows.filter((row) => row.available && row.complete === false).length;
  return (
    <Panel
      className={className}
      metric={metric}
      title={title ?? def.label}
      error={error}
      note={def.caveat}
    >
      {partialRows > 0 ? (
        <p className="mb-3 rounded-md border border-amber-200 bg-amber-50 px-2.5 py-2 text-[11px] leading-relaxed text-amber-800 dark:border-amber-900/60 dark:bg-amber-950/25 dark:text-amber-300">
          {partialRows === 1
            ? '1 measured company has partial source coverage. Its total and rank are provisional; WoW change is withheld.'
            : partialRows + ' measured companies have partial source coverage. Their totals and ranks are provisional; WoW change is withheld.'}
        </p>
      ) : null}
      <BarLeaderboard
        rows={rows}
        metric={metric}
        focusCompanyId={focusCompanyId}
        color={color}
        maxRows={maxRows}
        showCompetitorAverage={showCompetitorAverage}
        showPlatformBreakdown={showPlatformBreakdown}
      />
    </Panel>
  );
}
