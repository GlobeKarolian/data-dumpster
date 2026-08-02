'use client';

import * as React from 'react';
import {
  CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis,
  type TooltipContentProps,
} from 'recharts';
import type { MetricKey, TimeSeriesPoint } from '@/lib/types';
import { parseDateValue } from '@/lib/dates';
import { compactNumber, cn } from '@/lib/utils';
import { formatMetric } from '@/components/ui/format';
import { ChartFrame, ChartTooltipCard } from './chart-frame';
import { CHART_HEIGHT, axisProps, gridProps } from './theme';

export interface SeriesDef {
  key: string;
  label: string;
  color: string;
  /** The focus company is drawn heavier and never dimmed by default. */
  emphasis?: boolean;
}

export interface TimeSeriesChartProps {
  data: TimeSeriesPoint[];
  series: SeriesDef[];
  metric: MetricKey;
  height?: number;
  granularity?: 'day' | 'week' | 'month';
  emptyHint?: string;
}

function tickDate(value: string, granularity: 'day' | 'week' | 'month'): string {
  const d = parseDateValue(value);
  if (Number.isNaN(+d)) return value;
  if (granularity === 'month') return new Intl.DateTimeFormat('en-US', { month: 'short', year: '2-digit' }).format(d);
  return new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric' }).format(d);
}

/**
 * Multi-company trend lines with a click-to-toggle legend. Toggling matters
 * more than it looks: with eight competitors on one axis the only way to read a
 * pair against each other is to switch the rest off.
 */
export function TimeSeriesChart({
  data,
  series,
  metric,
  height = CHART_HEIGHT.medium,
  granularity = 'day',
  emptyHint,
}: TimeSeriesChartProps) {
  const [hidden, setHidden] = React.useState<Set<string>>(new Set());
  const visible = series.filter((s) => !hidden.has(s.key));

  const toggle = (key: string) => {
    setHidden((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const hasMeasuredPoint = data.some((point) =>
    series.some((definition) => typeof point[definition.key] === 'number'));
  const isEmpty = data.length === 0 || series.length === 0 || !hasMeasuredPoint;

  return (
    <div>
      <ChartFrame
        height={height}
        isEmpty={isEmpty}
        emptyLabel={hasMeasuredPoint ? 'No activity in this window' : 'No measured values in this window'}
        emptyHint={
          emptyHint
          ?? (metric === 'audienceNetChange' || metric === 'audienceGrowthRate'
            ? 'Audience change needs at least two observations in each bucket.'
            : 'Once channels are connected and ingested, trend lines appear here.')
        }
      >
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data} margin={{ top: 8, right: 12, bottom: 0, left: 4 }}>
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
              tickFormatter={(v: number) => compactNumber(v)}
            />
            <Tooltip
              cursor={{ stroke: 'var(--pb-grid)', strokeWidth: 1 }}
              content={(props: TooltipContentProps) => {
                if (!props.active || !props.payload?.length) return null;
                const rows = props.payload
                  .map((p) => ({
                    label: series.find((s) => s.key === p.dataKey)?.label ?? String(p.name ?? ''),
                    value: formatMetric(typeof p.value === 'number' ? p.value : null, metric, 'full'),
                    color: typeof p.color === 'string' ? p.color : undefined,
                  }))
                  .sort((a, b) => a.label.localeCompare(b.label));
                return (
                  <ChartTooltipCard
                    title={tickDate(String(props.label ?? ''), granularity)}
                    rows={rows}
                  />
                );
              }}
            />
            {visible.map((s) => (
              <Line
                key={s.key}
                type="monotone"
                dataKey={s.key}
                name={s.label}
                stroke={s.color}
                strokeWidth={s.emphasis ? 2.25 : 1.5}
                dot={false}
                activeDot={{ r: 3, strokeWidth: 0 }}
                isAnimationActive={false}
                connectNulls={false}
              />
            ))}
          </LineChart>
        </ResponsiveContainer>
      </ChartFrame>

      {series.length > 0 ? (
        <ul className="mt-3 flex flex-wrap gap-x-3 gap-y-1.5">
          {series.map((s) => {
            const off = hidden.has(s.key);
            return (
              <li key={s.key}>
                <button
                  type="button"
                  onClick={() => toggle(s.key)}
                  aria-pressed={!off}
                  className={cn(
                    'inline-flex items-center gap-1.5 rounded px-1 py-0.5 text-[11px] transition-colors',
                    off
                      ? 'text-zinc-400 dark:text-zinc-600'
                      : 'text-zinc-600 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100',
                  )}
                >
                  <span
                    aria-hidden
                    className="h-2 w-2 rounded-full"
                    style={{ backgroundColor: off ? 'var(--pb-muted-series)' : s.color }}
                  />
                  <span className={cn(off && 'line-through')}>{s.label}</span>
                </button>
              </li>
            );
          })}
        </ul>
      ) : null}
    </div>
  );
}
