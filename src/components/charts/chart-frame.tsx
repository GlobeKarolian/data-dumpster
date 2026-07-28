'use client';

import * as React from 'react';
import { cn } from '@/lib/utils';

/**
 * Every chart shares this wrapper so the zero-data path is identical
 * everywhere: a fixed-height box with a quiet explanation rather than an empty
 * SVG or, worse, a collapsed container that makes the page jump.
 */
export function ChartFrame({
  height,
  isEmpty,
  emptyLabel = 'No data in this window',
  emptyHint,
  children,
  className,
}: {
  height: number;
  isEmpty: boolean;
  emptyLabel?: string;
  emptyHint?: string;
  children: React.ReactNode;
  className?: string;
}) {
  if (isEmpty) {
    return (
      <div
        style={{ height }}
        className={cn(
          'flex flex-col items-center justify-center rounded border border-dashed border-zinc-200 text-center',
          'dark:border-zinc-800',
          className,
        )}
      >
        <p className="text-xs font-medium text-zinc-500 dark:text-zinc-400">{emptyLabel}</p>
        {emptyHint ? (
          <p className="mt-1 max-w-xs px-4 text-[11px] leading-relaxed text-zinc-400 dark:text-zinc-600">
            {emptyHint}
          </p>
        ) : null}
      </div>
    );
  }
  return (
    <div style={{ height }} className={cn('w-full', className)}>
      {children}
    </div>
  );
}

export interface TooltipRow {
  label: string;
  value: string;
  color?: string;
}

/** Shared tooltip surface, so recharts default styling never leaks through. */
export function ChartTooltipCard({ title, rows }: { title?: string; rows: TooltipRow[] }) {
  return (
    <div className="rounded-md border border-zinc-200 bg-white px-2.5 py-2 text-xs shadow-lg dark:border-zinc-700 dark:bg-zinc-900">
      {title ? (
        <p className="mb-1.5 border-b border-zinc-100 pb-1.5 font-medium text-zinc-900 dark:border-zinc-800 dark:text-zinc-100">
          {title}
        </p>
      ) : null}
      <ul className="space-y-1">
        {rows.map((r, i) => (
          <li key={r.label + i} className="flex items-center gap-2">
            {r.color ? (
              <span
                aria-hidden
                className="h-2 w-2 shrink-0 rounded-full"
                style={{ backgroundColor: r.color }}
              />
            ) : null}
            <span className="min-w-0 flex-1 truncate text-zinc-600 dark:text-zinc-400">{r.label}</span>
            <span className="pb-num font-medium text-zinc-900 dark:text-zinc-100">{r.value}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
