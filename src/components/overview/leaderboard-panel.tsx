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
}: LeaderboardPanelProps) {
  const def = METRIC_DEFS[metric];
  return (
    <Panel
      className={className}
      metric={metric}
      title={title ?? def.label}
      error={error}
      note={def.caveat}
    >
      <BarLeaderboard
        rows={rows}
        metric={metric}
        focusCompanyId={focusCompanyId}
        color={color}
        maxRows={maxRows}
        showCompetitorAverage={showCompetitorAverage}
      />
    </Panel>
  );
}
