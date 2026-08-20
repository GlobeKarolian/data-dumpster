'use client';

import * as React from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import type { TagSeriesRow } from '@/lib/metrics/contract';
import { lifecycleRank, readLifecycle, type LifecyclePhase } from '@/lib/metrics/story-lifecycle';
import { hrefWithGlobalParams } from '@/components/common/use-url-state';
import { EmptyState } from '@/components/ui/empty-state';
import { Tooltip } from '@/components/ui/tooltip';
import { Activity } from 'lucide-react';

const PHASE_STYLE: Record<LifecyclePhase, { label: string; className: string; why: string }> = {
  peaking: {
    label: 'Peaking',
    className: 'text-red-700 dark:text-red-400',
    why: 'The highest-earning day of the window is the most recent day we can judge. '
      + 'Reaction is still climbing rather than settling.',
  },
  cresting: {
    label: 'Holding',
    className: 'text-emerald-700 dark:text-emerald-400',
    why: 'Reaction over the last few days is still close to this story’s best day. '
      + 'The audience has not moved on.',
  },
  flat: {
    label: 'Steady',
    className: 'text-zinc-500 dark:text-zinc-400',
    why: 'Reaction has neither spiked nor collapsed. The story is running at a '
      + 'consistent level rather than building to anything.',
  },
  fading: {
    label: 'Fading',
    className: 'text-zinc-400 dark:text-zinc-500',
    why: 'Reaction over the last few days has fallen well below this story’s peak. '
      + 'It may still be worth covering, but the audience case for more posts is weaker.',
  },
  building: { label: 'Building', className: 'text-zinc-500', why: 'Reaction is rising toward a peak.' },
  unknown: { label: '—', className: 'text-zinc-400', why: 'Too little of the window has matured to read a shape.' },
};

/** Mirrors readLifecycle's exclusion so the drawing and the verdict agree. */
const MATURING_BUCKETS_SHOWN = 2;

const MATURING_NOTE =
  'The two most recent days are drawn but excluded from this verdict: a post published '
  + 'today has not collected its reaction yet, so judging by it would make every story '
  + 'look finished.';

function dayLabel(date: string): string {
  const parsed = new Date(date + 'T12:00:00');
  return Number.isNaN(parsed.getTime())
    ? date
    : parsed.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
}

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
function Arc({ points, color, peakDate, maturingFrom }: {
  points: TagSeriesRow['points'];
  color: string;
  peakDate: string | null;
  maturingFrom: number;
}) {
  const max = Math.max(...points.map((p) => p.engagement), 1);
  const peakValue = points.find((p) => p.date === peakDate)?.engagement ?? 0;

  return (
    <div className="flex h-9 items-end gap-px">
      {points.map((point, index) => {
        const height = Math.max(2, Math.round((point.engagement / max) * 36));
        const isPeak = point.date === peakDate;
        const maturing = index >= maturingFrom;
        const shareOfPeak = peakValue > 0 ? Math.round((point.engagement / peakValue) * 100) : null;
        const narrative = point.narrative;

        return (
          <Tooltip
            key={point.date}
            wide
            side="top"
            content={(
              <span className="block space-y-1.5">
                <span className="block font-medium text-zinc-900 dark:text-zinc-100">
                  {dayLabel(point.date)}
                  {isPeak ? ' · the peak' : ''}
                  {maturing ? ' · still landing' : ''}
                </span>
                <span className="block text-zinc-600 dark:text-zinc-400">
                  {point.posts === 0
                    ? 'No posts carried this tag.'
                    : `${point.posts.toLocaleString()} post${point.posts === 1 ? '' : 's'} earned `
                      + `${point.engagement.toLocaleString()} engagement`
                      + (shareOfPeak !== null && !isPeak ? `, ${shareOfPeak}% of the peak day.` : '.')}
                </span>
                {narrative ? (
                  <>
                    <span className="block text-zinc-800 dark:text-zinc-200">
                      {narrative.text}
                    </span>
                    <span className="block text-[11px] text-zinc-500">
                      Written from {narrative.postsConsidered.toLocaleString()} posts that day.
                      Counts above are computed, not written by the model.
                    </span>
                  </>
                ) : point.posts > 0 ? (
                  <span className="block text-zinc-500">
                    No summary for this day yet. Narratives are written on a schedule,
                    biggest and most recent days first.
                  </span>
                ) : null}
                {maturing ? (
                  <span className="block text-zinc-500">{MATURING_NOTE}</span>
                ) : null}
              </span>
            )}
          >
            <span
              tabIndex={0}
              className="min-w-[3px] flex-1 cursor-help rounded-sm transition-opacity hover:opacity-100"
              style={{
                height,
                backgroundColor: color,
                opacity: isPeak ? 1 : maturing ? 0.18 : 0.32,
              }}
            />
          </Tooltip>
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
              <Tooltip
                wide
                side="bottom"
                content={(
                  <span className="block space-y-1.5">
                    <span className="block font-medium text-zinc-900 dark:text-zinc-100">
                      Why “{phase.label}”
                    </span>
                    <span className="block text-zinc-600 dark:text-zinc-400">{phase.why}</span>
                    {reading.peakDate ? (
                      <span className="block text-zinc-600 dark:text-zinc-400">
                        Peak day {dayLabel(reading.peakDate)} at{' '}
                        {reading.peakEngagement.toLocaleString()} engagement.
                        {reading.shareOfPeak !== null
                          ? ` The last few days average ${Math.round(reading.shareOfPeak * 100)}% of it.`
                          : ''}
                      </span>
                    ) : null}
                    <span className="block text-zinc-500">{MATURING_NOTE}</span>
                  </span>
                )}
              >
                <p
                  tabIndex={0}
                  className={'mt-0.5 w-fit cursor-help text-[10px] font-semibold uppercase tracking-wider ' + phase.className}
                >
                  {phase.label}
                </p>
              </Tooltip>
            </div>

            <div className="min-w-40 flex-1">
              <Arc
                points={row.points}
                color={color}
                peakDate={reading.peakDate}
                maturingFrom={Math.max(0, row.points.length - MATURING_BUCKETS_SHOWN)}
              />
            </div>

            <Tooltip
              side="bottom"
              content={
                `Every post carrying this tag in the selected window, across the whole landscape: `
                + `${reading.totalPosts.toLocaleString()} posts earning `
                + `${reading.totalEngagement.toLocaleString()} engagement. `
                + 'Includes the most recent days, whose reaction is still accruing.'
              }
            >
              <div tabIndex={0} className="w-24 shrink-0 cursor-help text-right">
                <p className="pb-num text-sm font-semibold tabular-nums text-zinc-900 dark:text-zinc-100">
                  {compact(reading.totalEngagement)}
                </p>
                <p className="text-[10px] uppercase tracking-wider text-zinc-400">
                  {reading.totalPosts} posts
                </p>
              </div>
            </Tooltip>

            <p className="w-full text-xs leading-relaxed text-zinc-500 sm:w-auto sm:flex-1 dark:text-zinc-400">
              {reading.summary}
            </p>
          </li>
        );
      })}
    </ul>
  );
}
