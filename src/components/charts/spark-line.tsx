'use client';

import * as React from 'react';
import { Area, AreaChart, ResponsiveContainer } from 'recharts';
import { ACCENT } from './theme';

export interface SparkPoint {
  date: string;
  value: number;
}

export interface SparkLineProps {
  data: SparkPoint[];
  height?: number;
  /** Defaults to the accent; pass a platform or company color when relevant. */
  color?: string;
  /** Renders the fill under the line. Off for very small tiles. */
  filled?: boolean;
  ariaLabel?: string;
}

/**
 * A shape, not a chart. No axes, no tooltip, no numbers: its only job is to say
 * whether the headline figure arrived smoothly or in one spike, which is
 * exactly the question a delta percentage cannot answer.
 */
export function SparkLine({
  data,
  height = 40,
  color = ACCENT,
  filled = true,
  ariaLabel,
}: SparkLineProps) {
  const id = React.useId().replace(/:/g, '');
  const usable = data.filter((d) => Number.isFinite(d.value));

  if (usable.length < 2) {
    return (
      <div
        style={{ height }}
        className="flex items-center"
        aria-hidden
      >
        <div className="h-px w-full bg-zinc-200 dark:bg-zinc-800" />
      </div>
    );
  }

  return (
    <div style={{ height }} role="img" aria-label={ariaLabel ?? 'Trend over the selected window'}>
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={usable} margin={{ top: 2, right: 0, bottom: 2, left: 0 }}>
          <defs>
            <linearGradient id={'spark-' + id} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={color} stopOpacity={0.28} />
              <stop offset="100%" stopColor={color} stopOpacity={0} />
            </linearGradient>
          </defs>
          <Area
            type="monotone"
            dataKey="value"
            stroke={color}
            strokeWidth={1.5}
            fill={filled ? 'url(#spark-' + id + ')' : 'none'}
            isAnimationActive={false}
            dot={false}
            activeDot={false}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}
