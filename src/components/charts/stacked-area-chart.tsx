'use client';

import * as React from 'react';
import {
  Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis,
  type TooltipContentProps,
} from 'recharts';
import type { MetricKey, TimeSeriesPoint } from '@/lib/types';
import { parseDateValue } from '@/lib/dates';
import { compactNumber } from '@/lib/utils';
import { formatMetric } from '@/components/ui/format';
import { ChartFrame, ChartTooltipCard } from './chart-frame';
import { CHART_HEIGHT, axisProps, gridProps } from './theme';
import type { SeriesDef } from './time-series-chart';

export interface StackedAreaChartProps {
  data: TimeSeriesPoint[];
  series: SeriesDef[];
  metric: MetricKey;
  height?: number;
  /** Normalize each bucket to 100 percent, for share-of-voice style reads. */
  percentage?: boolean;
  granularity?: 'day' | 'week' | 'month';
  emptyHint?: string;
}

function tickDate(value: string, granularity: 'day' | 'week' | 'month'): string {
  const d = parseDateValue(value);
  if (Number.isNaN(+d)) return value;
  if (granularity === 'month') return new Intl.DateTimeFormat('en-US', { month: 'short', year: '2-digit' }).format(d);
  return new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric' }).format(d);
}

/** Composition over time: who owned the volume, and how that split shifted. */
export function StackedAreaChart({
  data,
  series,
  metric,
  height = CHART_HEIGHT.medium,
  percentage,
  granularity = 'day',
  emptyHint,
}: StackedAreaChartProps) {
  const rendered = React.useMemo(() => {
    if (!percentage) return data;
    return data.map((point) => {
      const total = series.reduce((sum, s) => {
        const v = point[s.key];
        return sum + (typeof v === 'number' ? v : 0);
      }, 0);
      const next: TimeSeriesPoint = { date: point.date };
      for (const s of series) {
        const v = point[s.key];
        next[s.key] = total > 0 && typeof v === 'number' ? v / total : 0;
      }
      return next;
    });
  }, [data, series, percentage]);

  return (
    <ChartFrame
      height={height}
      isEmpty={rendered.length === 0 || series.length === 0}
      emptyLabel="Nothing to stack yet"
      emptyHint={emptyHint ?? 'This chart fills in once there are posts inside the selected window.'}
    >
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={rendered} margin={{ top: 8, right: 12, bottom: 0, left: 4 }}>
          <CartesianGrid {...gridProps} />
          <XAxis
            dataKey="date"
            {...axisProps}
            minTickGap={24}
            tickFormatter={(v: string) => tickDate(v, granularity)}
          />
          <YAxis
            {...axisProps}
            width={48}
            domain={percentage ? [0, 1] : undefined}
            tickFormatter={(v: number) => (percentage ? Math.round(v * 100) + '%' : compactNumber(v))}
          />
          <Tooltip
            cursor={{ stroke: 'var(--pb-grid)', strokeWidth: 1 }}
            content={(props: TooltipContentProps) => {
              if (!props.active || !props.payload?.length) return null;
              const rows = [...props.payload]
                .reverse()
                .map((p) => ({
                  label: series.find((s) => s.key === p.dataKey)?.label ?? String(p.name ?? ''),
                  value: percentage
                    ? ((typeof p.value === 'number' ? p.value : 0) * 100).toFixed(1) + '%'
                    : formatMetric(typeof p.value === 'number' ? p.value : null, metric, 'full'),
                  color: typeof p.color === 'string' ? p.color : undefined,
                }));
              return (
                <ChartTooltipCard title={tickDate(String(props.label ?? ''), granularity)} rows={rows} />
              );
            }}
          />
          {series.map((s) => (
            <Area
              key={s.key}
              type="monotone"
              dataKey={s.key}
              name={s.label}
              stackId="stack"
              stroke={s.color}
              strokeWidth={1}
              fill={s.color}
              fillOpacity={0.6}
              isAnimationActive={false}
            />
          ))}
        </AreaChart>
      </ResponsiveContainer>
    </ChartFrame>
  );
}
