import * as React from 'react';
import { ArrowDownRight, ArrowUpRight, Minus } from 'lucide-react';
import { cn, formatChange } from '@/lib/utils';
import { Tooltip } from './tooltip';

const TONE_CLASS = {
  up: 'text-emerald-700 dark:text-emerald-400',
  down: 'text-red-700 dark:text-red-400',
  flat: 'text-zinc-500 dark:text-zinc-400',
  na: 'text-zinc-400 dark:text-zinc-600',
} as const;

export interface DeltaBadgeProps {
  changePct: number | null | undefined;
  /** Flip the color mapping for metrics where down is good. */
  invert?: boolean;
  /** Adds a "vs prior period" hover explanation with the raw prior value. */
  previousLabel?: string;
  className?: string;
  size?: 'sm' | 'md';
}

/**
 * Percent change, rendered with an opinion.
 *
 * Two rules matter here. Deltas are muted, not celebratory: a competitive tool
 * is not a scoreboard for one side. And beyond 1000% the badge says so instead
 * of printing a figure that only ever means the baseline was near zero.
 */
export function DeltaBadge({ changePct, invert, previousLabel, className, size = 'sm' }: DeltaBadgeProps) {
  const { label, tone } = formatChange(changePct);
  const shown = invert && (tone === 'up' || tone === 'down') ? (tone === 'up' ? 'down' : 'up') : tone;
  const Icon = tone === 'up' ? ArrowUpRight : tone === 'down' ? ArrowDownRight : Minus;

  const body = (
    <span
      className={cn(
        'pb-num inline-flex items-center gap-0.5 font-medium',
        size === 'sm' ? 'text-xs' : 'text-sm',
        TONE_CLASS[shown],
        className,
      )}
    >
      {tone === 'na' ? null : <Icon className={size === 'sm' ? 'h-3 w-3' : 'h-3.5 w-3.5'} aria-hidden />}
      {label}
    </span>
  );

  if (tone === 'na') {
    return (
      <Tooltip
        content="No comparable figure in the previous window. Data Dumpster shows a blank rather than an invented percentage."
        side="top"
      >
        <span tabIndex={0}>{body}</span>
      </Tooltip>
    );
  }

  if (!previousLabel) return body;

  return (
    <Tooltip content={'Previous window: ' + previousLabel} side="top">
      <span tabIndex={0}>{body}</span>
    </Tooltip>
  );
}
