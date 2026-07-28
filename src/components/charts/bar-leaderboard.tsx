'use client';

import * as React from 'react';
import {
  Bar, BarChart, Cell, LabelList, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis,
  type TooltipContentProps,
} from 'recharts';
import type { MetricKey, MetricRow } from '@/lib/types';
import { compactNumber } from '@/lib/utils';
import { formatMetric } from '@/components/ui/format';
import { ChartFrame, ChartTooltipCard } from './chart-frame';
import { ACCENT, companyColor } from './theme';

export interface BarLeaderboardProps {
  rows: MetricRow[];
  metric: MetricKey;
  /** The company the landscape is written from. Drawn in the accent. */
  focusCompanyId?: string | null;
  /** Draws the competitor mean as a dashed reference line. */
  showCompetitorAverage?: boolean;
  maxRows?: number;
  emptyHint?: string;
  /** Force a color for every bar, e.g. a platform brand color. */
  color?: string;
}

interface Datum {
  id: string;
  name: string;
  value: number;
  previousValue: number | null;
  changePct: number | null;
  isFocus: boolean;
  fill: string;
}

/**
 * Horizontal leaderboard.
 *
 * The focus company is the only bar in the accent, and the dashed line is the
 * mean of everyone else. That line is the whole point: a rank tells you the
 * order, but only the distance from the competitive average tells you whether
 * the order matters.
 */
export function BarLeaderboard({
  rows,
  metric,
  focusCompanyId,
  showCompetitorAverage = true,
  maxRows = 12,
  emptyHint,
  color,
}: BarLeaderboardProps) {
  const data: Datum[] = React.useMemo(
    () =>
      rows.slice(0, maxRows).map((r, i) => {
        const isFocus = Boolean(focusCompanyId && r.company.id === focusCompanyId);
        return {
          id: r.company.id,
          name: r.company.name,
          value: Number.isFinite(r.value) ? r.value : 0,
          previousValue: r.previousValue ?? null,
          changePct: r.changePct ?? null,
          isFocus,
          fill: isFocus ? ACCENT : (color ?? companyColor(r.company, i, focusCompanyId)),
        };
      }),
    [rows, maxRows, focusCompanyId, color],
  );

  const competitors = data.filter((d) => !d.isFocus);
  const average =
    showCompetitorAverage && competitors.length > 0
      ? competitors.reduce((sum, d) => sum + d.value, 0) / competitors.length
      : null;

  const hasSignal = data.some((d) => d.value !== 0);
  const height = Math.max(120, data.length * 26 + 28);

  return (
    <ChartFrame
      height={height}
      isEmpty={data.length === 0 || !hasSignal}
      emptyLabel={data.length === 0 ? 'No companies in this landscape' : 'Every company measured zero here'}
      emptyHint={
        emptyHint ??
        (data.length === 0
          ? 'Add companies and channels, then run an ingest to populate this leaderboard.'
          : 'Nothing was published or measured in this window. Widen the date range to check.')
      }
    >
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} layout="vertical" margin={{ top: 0, right: 56, bottom: 0, left: 0 }}>
          <XAxis type="number" hide domain={[0, 'dataMax']} />
          <YAxis
            type="category"
            dataKey="name"
            width={132}
            tickLine={false}
            axisLine={false}
            tick={{ fill: 'var(--pb-label)', fontSize: 11 }}
            interval={0}
          />
          <Tooltip
            cursor={{ fill: 'var(--pb-grid)', fillOpacity: 0.35 }}
            content={(props: TooltipContentProps) => {
              if (!props.active || !props.payload?.length) return null;
              const d = props.payload[0].payload as Datum;
              const rowsOut = [
                { label: 'This window', value: formatMetric(d.value, metric, 'full'), color: d.fill },
              ];
              if (d.previousValue !== null) {
                rowsOut.push({
                  label: 'Previous window',
                  value: formatMetric(d.previousValue, metric, 'full'),
                  color: 'var(--pb-muted-series)',
                });
              }
              if (average !== null) {
                rowsOut.push({
                  label: 'Competitor average',
                  value: formatMetric(average, metric, 'full'),
                  color: 'var(--pb-reference)',
                });
              }
              return <ChartTooltipCard title={d.name} rows={rowsOut} />;
            }}
          />
          {average !== null ? (
            <ReferenceLine
              x={average}
              stroke="var(--pb-reference)"
              strokeDasharray="4 3"
              strokeWidth={1}
              label={{
                value: 'avg ' + compactNumber(average),
                position: 'top',
                fill: 'var(--pb-label)',
                fontSize: 10,
              }}
            />
          ) : null}
          <Bar dataKey="value" radius={[0, 2, 2, 0]} barSize={14} isAnimationActive={false}>
            {data.map((d) => (
              <Cell key={d.id} fill={d.fill} fillOpacity={d.isFocus ? 1 : 0.75} />
            ))}
            <LabelList
              dataKey="value"
              position="right"
              formatter={(v) => formatMetric(typeof v === 'number' ? v : null, metric)}
              style={{ fill: 'var(--pb-label)', fontSize: 10, fontVariantNumeric: 'tabular-nums' }}
            />
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </ChartFrame>
  );
}
