import * as React from 'react';
import { METRIC_DEFS } from '@/lib/metrics/definitions';
import type { MetricKey } from '@/lib/types';
import { cn } from '@/lib/utils';
import { InfoTip } from './tooltip';

/**
 * The definition tooltip body. Description, then the arithmetic, then the
 * caveat if the metric has one. Never hand-written at a call site: it always
 * comes out of METRIC_DEFS so the UI and the docs cannot drift.
 */
export function MetricDefinition({ metric }: { metric: MetricKey }) {
  const def = METRIC_DEFS[metric];
  return (
    <span className="block space-y-2">
      <span className="block text-[11px] font-semibold uppercase tracking-wider text-zinc-500 dark:text-zinc-400">
        {def.label}
      </span>
      <span className="block text-zinc-700 dark:text-zinc-300">{def.description}</span>
      <span className="block border-t border-zinc-200 pt-2 dark:border-zinc-700">
        <span className="block text-[10px] font-semibold uppercase tracking-wider text-zinc-400 dark:text-zinc-500">
          How it is computed
        </span>
        <span className="pb-num block text-zinc-600 dark:text-zinc-400">{def.formula}</span>
      </span>
      {def.caveat ? (
        <span className="block border-t border-zinc-200 pt-2 dark:border-zinc-700">
          <span className="block text-[10px] font-semibold uppercase tracking-wider text-amber-600 dark:text-amber-500">
            Read with care
          </span>
          <span className="block text-zinc-600 dark:text-zinc-400">{def.caveat}</span>
        </span>
      ) : null}
    </span>
  );
}

export interface MetricLabelProps {
  metric: MetricKey;
  /** Use the compact name, for table headers and tight tiles. */
  short?: boolean;
  /** Override the visible text while keeping the definition tooltip. */
  text?: string;
  className?: string;
  side?: 'top' | 'bottom';
  align?: 'start' | 'center' | 'end';
}

/** A metric name plus its definition tooltip. Use this instead of a bare string. */
export function MetricLabel({
  metric,
  short,
  text,
  className,
  side = 'bottom',
  align = 'start',
}: MetricLabelProps) {
  const def = METRIC_DEFS[metric];
  return (
    <span className={cn('inline-flex items-center gap-1.5', className)}>
      <span>{text ?? (short ? def.shortLabel : def.label)}</span>
      <InfoTip content={<MetricDefinition metric={metric} />} label={def.label} side={side} align={align} />
    </span>
  );
}
