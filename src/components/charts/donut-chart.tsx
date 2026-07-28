'use client';

import * as React from 'react';
import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip, type TooltipContentProps } from 'recharts';
import { compactNumber, percent } from '@/lib/utils';
import { ChartFrame, ChartTooltipCard } from './chart-frame';

export interface DonutSlice {
  key: string;
  label: string;
  value: number;
  color: string;
}

export interface DonutChartProps {
  slices: DonutSlice[];
  height?: number;
  /** Big number in the middle. Usually the total. */
  centerLabel?: string;
  centerCaption?: string;
  emptyHint?: string;
}

/** Platform mix. A share chart, so the legend carries the percentages. */
export function DonutChart({
  slices,
  height = 220,
  centerLabel,
  centerCaption,
  emptyHint,
}: DonutChartProps) {
  const usable = slices.filter((s) => Number.isFinite(s.value) && s.value > 0);
  const total = usable.reduce((sum, s) => sum + s.value, 0);

  return (
    <div className="flex flex-col gap-4 sm:flex-row sm:items-center">
      <div className="relative shrink-0" style={{ width: height, height }}>
        <ChartFrame
          height={height}
          isEmpty={usable.length === 0}
          emptyLabel="No mix to show"
          emptyHint={emptyHint ?? 'Connect at least one channel to see where the audience actually is.'}
        >
          <ResponsiveContainer width="100%" height="100%">
            <PieChart>
              <Pie
                data={usable}
                dataKey="value"
                nameKey="label"
                innerRadius="62%"
                outerRadius="92%"
                paddingAngle={1.5}
                stroke="var(--pb-surface)"
                strokeWidth={2}
                isAnimationActive={false}
              >
                {usable.map((s) => (
                  <Cell key={s.key} fill={s.color} />
                ))}
              </Pie>
              <Tooltip
                content={(props: TooltipContentProps) => {
                  if (!props.active || !props.payload?.length) return null;
                  const p = props.payload[0];
                  const slice = p.payload as DonutSlice;
                  const value = typeof p.value === 'number' ? p.value : 0;
                  return (
                    <ChartTooltipCard
                      rows={[
                        { label: slice.label, value: compactNumber(value), color: slice.color },
                        {
                          label: 'Share',
                          value: total > 0 ? percent(value / total, 1) : '—',
                        },
                      ]}
                    />
                  );
                }}
              />
            </PieChart>
          </ResponsiveContainer>
        </ChartFrame>
        {usable.length > 0 && centerLabel ? (
          <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
            <span className="pb-num text-lg font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
              {centerLabel}
            </span>
            {centerCaption ? (
              <span className="text-[10px] uppercase tracking-wider text-zinc-500">{centerCaption}</span>
            ) : null}
          </div>
        ) : null}
      </div>

      {usable.length > 0 ? (
        <ul className="min-w-0 flex-1 space-y-1.5">
          {[...usable]
            .sort((a, b) => b.value - a.value)
            .map((s) => (
              <li key={s.key} className="flex items-center gap-2 text-xs">
                <span
                  aria-hidden
                  className="h-2 w-2 shrink-0 rounded-full"
                  style={{ backgroundColor: s.color }}
                />
                <span className="min-w-0 flex-1 truncate text-zinc-600 dark:text-zinc-400">{s.label}</span>
                <span className="pb-num shrink-0 text-zinc-500">{compactNumber(s.value)}</span>
                <span className="pb-num w-12 shrink-0 text-right font-medium text-zinc-900 dark:text-zinc-100">
                  {total > 0 ? percent(s.value / total, 1) : '—'}
                </span>
              </li>
            ))}
        </ul>
      ) : null}
    </div>
  );
}
