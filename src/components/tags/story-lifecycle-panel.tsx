'use client';

import * as React from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import type { TagSeriesRow } from '@/lib/metrics/contract';
import { lifecycleRank, readLifecycle, type LifecyclePhase } from '@/lib/metrics/story-lifecycle';
import { hrefWithGlobalParams } from '@/components/common/use-url-state';
import { EmptyState } from '@/components/ui/empty-state';
import { Activity } from 'lucide-react';

const PHASE_STYLE: Record<LifecyclePhase, { label: string; className: string }> = {
  peaking: { label: 'Peaking', className: 'text-red-700 dark:text-red-400' },
  cresting: { label: 'Holding', className: 'text-emerald-700 dark:text-emerald-400' },
  flat: { label: 'Steady', className: 'text-zinc-500 dark:text-zinc-400' },
  fading: { label: 'Fading', className: 'text-zinc-400 dark:text-zinc-500' },
  building: { label: 'Building', className: 'text-zinc-500' },
  unknown: { label: '—', className: 'text-zinc-400' },
};

function compact(value: number): string {
  const abs = Math.abs(value);
  if (abs >= 1_000_000) return `${(value / 1_000_000).toFixed(abs >= 10_000_000 ? 0 : 1)}M`;
  if (abs >= 1_000) return `${(value / 1_000).toFixed(abs >= 10_000 ? 0 : 1)}k`;
  return String(Math.round(value));
}

/**
 * The arc, drawn small.
 *
 * Bars are engagement per bucket; the peak bar is filled in the tag's own
 * colour so the shape reads at a glance without a legend. Deliberately not a
 * smoothed line: these are counts per day, and a curve through them would
 * imply measurements between the days that do not exist.
 */
function Arc({ points, color, peakDate }: {
  points: { date: string; engagement: number }[];
  color: string;
  peakDate: string | null;
}) {
  const max = Math.max(...points.map((p) => p.engagement), 1);
  return (
    <div className="flex h-9 items-end gap-px" aria-hidden>
      {points.map((point) => {
        const height = Math.max(2, Math.round((point.engagement / max) * 36));
        const isPeak = point.date === peakDate;
        return (
          <span
            key={point.date}
            className="min-w-[2px] flex-1 rounded-sm transition-opacity"
            style={{
              height,
              backgroundColor: color,
              opacity: isPeak ? 1 : 0.32,
            }}
          />
        );
      })}
    </div>
  );
}

/**
 * Which stories are alive right now, and which the newsroom is still
 * publishing after the audience left.
 *
 * Sorted by liveness before size on purpose: a story peaking today matters
 * more to the next editorial decision than a bigger one that ended last week.
 */
export function StoryLifecyclePanel({ rows }: { rows: TagSeriesRow[] }) {
  const searchParams = useSearchParams();

  const readings = React.useMemo(() => rows
    .map((row) => ({ row, reading: readLifecycle(row.points) }))
    .filter(({ reading }) => reading.totalPosts > 0 && reading.phase !== 'unknown')
    .sort((a, b) => lifecycleRank(b.reading) - lifecycleRank(a.reading))
    .slice(0, 8), [rows]);

  if (readings.length === 0) {
    return (
      <EmptyState
        compact
        icon={Activity}
        title="No story arcs in this window"
        description="A tag needs several days of tagged posts before its shape can be read. Widen the window or wait for tagging to fill in."
      />
    );
  }

  return (
    <ul className="divide-y divide-zinc-100 dark:divide-zinc-800/60">
      {readings.map(({ row, reading }) => {
        const color = row.tag.color ?? '#71717a';
        const phase = PHASE_STYLE[reading.phase];
        return (
          <li key={row.tag.id} className="flex flex-wrap items-center gap-x-4 gap-y-2 px-1 py-3">
            <div className="w-40 shrink-0">
              <Link
                href={hrefWithGlobalParams('/posts', searchParams, { tags: row.tag.id })}
                prefetch={false}
                className="inline-flex items-center gap-2 text-sm font-medium text-zinc-900 underline-offset-2 hover:underline dark:text-zinc-100"
              >
                <span
                  aria-hidden
                  className="h-2 w-2 shrink-0 rounded-full"
                  style={{ backgroundColor: color }}
                />
                <span className="truncate">{row.tag.name}</span>
              </Link>
              <p className={'mt-0.5 text-[10px] font-semibold uppercase tracking-wider ' + phase.className}>
                {phase.label}
              </p>
            </div>

            <div className="min-w-40 flex-1">
              <Arc points={row.points} color={color} peakDate={reading.peakDate} />
            </div>

            <div className="w-24 shrink-0 text-right">
              <p className="pb-num text-sm font-semibold tabular-nums text-zinc-900 dark:text-zinc-100">
                {compact(reading.totalEngagement)}
              </p>
              <p className="text-[10px] uppercase tracking-wider text-zinc-400">
                {reading.totalPosts} posts
              </p>
            </div>

            <p className="w-full text-xs leading-relaxed text-zinc-500 sm:w-auto sm:flex-1 dark:text-zinc-400">
              {reading.summary}
            </p>
          </li>
        );
      })}
    </ul>
  );
}
