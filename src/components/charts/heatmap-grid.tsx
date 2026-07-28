'use client';

import * as React from 'react';
import type { PostingCadenceCell } from '@/lib/metrics/contract';
import { cn, compactNumber } from '@/lib/utils';
import { Tooltip } from '@/components/ui/tooltip';

const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const HOURS = Array.from({ length: 24 }, (_, h) => h);

export type HeatmapMeasure = 'postCount' | 'engagementPerPost';

export interface HeatmapGridProps {
  cells: PostingCadenceCell[];
  measure?: HeatmapMeasure;
  /** Base color for the ramp. Defaults to the accent. */
  color?: string;
  className?: string;
}

function hourLabel(h: number): string {
  if (h === 0) return '12a';
  if (h === 12) return '12p';
  return h < 12 ? h + 'a' : h - 12 + 'p';
}

/**
 * Posting cadence, 7 days by 24 hours.
 *
 * Two questions this answers that a line chart cannot: when does a competitor
 * actually publish, and are they publishing into hours where nobody engages.
 * Switching the measure from volume to engagement-per-post flips it from the
 * first question to the second.
 */
export function HeatmapGrid({
  cells,
  measure = 'postCount',
  color = '#C8102E',
  className,
}: HeatmapGridProps) {
  const { lookup, max } = React.useMemo(() => {
    const map = new Map<string, PostingCadenceCell>();
    let peak = 0;
    for (const c of cells) {
      // Source weekdays are 0=Sunday; the grid reads Monday-first.
      const row = (c.weekday + 6) % 7;
      map.set(row + ':' + c.hour, c);
      const v = measure === 'postCount' ? c.postCount : c.engagementPerPost;
      if (Number.isFinite(v) && v > peak) peak = v;
    }
    return { lookup: map, max: peak };
  }, [cells, measure]);

  if (cells.length === 0) {
    return (
      <div
        className={cn(
          'flex h-48 flex-col items-center justify-center rounded border border-dashed border-zinc-200 text-center dark:border-zinc-800',
          className,
        )}
      >
        <p className="text-xs font-medium text-zinc-500 dark:text-zinc-400">No cadence to map</p>
        <p className="mt-1 max-w-xs px-4 text-[11px] leading-relaxed text-zinc-400 dark:text-zinc-600">
          Once posts land in this window, their day and hour fill this grid.
        </p>
      </div>
    );
  }

  return (
    <div className={cn('min-w-0 overflow-x-auto', className)}>
      <div className="min-w-[640px]">
        <div className="flex">
          <div className="w-9 shrink-0" />
          <div className="grid flex-1 grid-cols-[repeat(24,minmax(0,1fr))] gap-px">
            {HOURS.map((h) => (
              <div
                key={h}
                className="pb-num text-center text-[9px] leading-4 text-zinc-400 dark:text-zinc-600"
              >
                {h % 3 === 0 ? hourLabel(h) : ''}
              </div>
            ))}
          </div>
        </div>

        {DAYS.map((day, row) => (
          <div key={day} className="flex items-center">
            <div className="w-9 shrink-0 pr-1.5 text-right text-[10px] text-zinc-500 dark:text-zinc-400">
              {day}
            </div>
            <div className="grid flex-1 grid-cols-[repeat(24,minmax(0,1fr))] gap-px">
              {HOURS.map((h) => {
                const cell = lookup.get(row + ':' + h);
                const raw = cell
                  ? measure === 'postCount'
                    ? cell.postCount
                    : cell.engagementPerPost
                  : 0;
                const intensity = max > 0 && raw > 0 ? Math.max(0.09, raw / max) : 0;
                return (
                  <Tooltip
                    key={h}
                    side="top"
                    content={
                      <span className="block">
                        <span className="block font-medium text-zinc-900 dark:text-zinc-100">
                          {day + ' ' + hourLabel(h)}
                        </span>
                        <span className="pb-num block text-zinc-600 dark:text-zinc-400">
                          {(cell?.postCount ?? 0) + ' posts'}
                        </span>
                        <span className="pb-num block text-zinc-600 dark:text-zinc-400">
                          {compactNumber(cell?.engagementPerPost ?? 0) + ' engagement per post'}
                        </span>
                      </span>
                    }
                  >
                    <button
                      type="button"
                      aria-label={day + ' ' + hourLabel(h) + ', ' + (cell?.postCount ?? 0) + ' posts'}
                      className="h-4 w-full rounded-[1px] ring-inset transition-shadow hover:ring-1 hover:ring-accent-600"
                      style={{
                        backgroundColor: intensity > 0 ? color : 'var(--pb-grid)',
                        opacity: intensity > 0 ? intensity : 0.5,
                      }}
                    />
                  </Tooltip>
                );
              })}
            </div>
          </div>
        ))}

        <div className="mt-3 flex items-center justify-end gap-2 text-[10px] text-zinc-500">
          <span>Less</span>
          {[0.12, 0.3, 0.5, 0.75, 1].map((o) => (
            <span
              key={o}
              aria-hidden
              className="h-3 w-4 rounded-[1px]"
              style={{ backgroundColor: color, opacity: o }}
            />
          ))}
          <span>More</span>
          <span className="pb-num ml-2 text-zinc-400">
            {'peak ' + (measure === 'postCount' ? compactNumber(max) + ' posts' : compactNumber(max) + ' eng/post')}
          </span>
        </div>
      </div>
    </div>
  );
}
