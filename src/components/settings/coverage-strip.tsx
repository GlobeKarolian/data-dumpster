import type { DayCoverage } from '@/lib/metrics/daily-coverage';
import { cn } from '@/lib/utils';

/**
 * Fourteen days of audience collection, one square each.
 *
 * The Collection coverage panel above answers "is anything wrong right now",
 * which is the question the app could already answer. This answers "did we
 * miss a day", which is the one that matters more and which nothing asked
 * until a weekly report surfaced it a week late.
 *
 * The distinction is worth the space because audience is a point-in-time
 * reading with no backfill. A red square is not a task to pick up, it is a
 * follower count that no longer exists for anyone, and the only useful
 * response is to make sure tomorrow's square is green.
 */
export function CoverageStrip({ days }: { days: DayCoverage[] }) {
  if (days.length === 0) return null;

  // Newest first from the query; render oldest to newest, like a calendar.
  const ordered = [...days].reverse();
  const closed = ordered.slice(0, -1);
  const scheduledClosed = closed.filter((d) => d.activeChannels > 0);
  const missed = scheduledClosed.filter((d) => !d.complete);
  const today = ordered[ordered.length - 1];
  const hasScheduledClosedDays = scheduledClosed.length > 0;

  return (
    <div className="rounded-lg border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900/40">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <h3 className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">
            Daily audience collection
          </h3>
          <p className="mt-0.5 text-[11px] leading-relaxed text-zinc-500 dark:text-zinc-400">
            A follower count can only be read on the day it happens. A day missed here cannot
            be recovered later.
          </p>
        </div>
        <p
          className={cn(
            'pb-num text-[11px] font-medium',
            hasScheduledClosedDays && missed.length === 0
              ? 'text-emerald-700 dark:text-emerald-400'
              : hasScheduledClosedDays
                ? 'text-red-700 dark:text-red-400'
                : 'text-zinc-500 dark:text-zinc-400',
          )}
        >
          {!hasScheduledClosedDays
            ? today.activeChannels > 0
              ? 'Audience history starts today'
              : 'Collection has not started'
            : missed.length === 0
              ? `${scheduledClosed.length} of ${scheduledClosed.length} scheduled days complete`
              : `${missed.length} of ${scheduledClosed.length} scheduled days incomplete`}
        </p>
      </div>

      <div className="mt-3 flex flex-wrap gap-1">
        {ordered.map((d) => {
          const isToday = d.day === today.day;
          const pct = Math.round(d.ratio * 100);
          return (
            <span
              key={d.day}
              title={
                `${d.day}: ${d.observedChannels} of ${d.activeChannels} channels (${pct}%)`
                + (isToday ? ' — still collecting today' : '')
                + (!isToday && d.activeChannels === 0 ? ' — collection was not scheduled' : '')
                + (!isToday && d.activeChannels > 0 && !d.complete ? ' — permanently incomplete' : '')
              }
              className={cn(
                'h-6 w-6 rounded-sm border',
                isToday
                  ? 'border-dashed border-zinc-400 bg-zinc-100 dark:border-zinc-600 dark:bg-zinc-800'
                  : d.activeChannels === 0
                    ? 'border-zinc-200 bg-zinc-100 dark:border-zinc-800 dark:bg-zinc-900'
                    : d.complete
                    ? 'border-emerald-600/30 bg-emerald-500/80'
                    : d.ratio >= 0.5
                      ? 'border-amber-600/30 bg-amber-400/80'
                      : 'border-red-600/30 bg-red-500/80',
              )}
            >
              <span className="sr-only">
                {`${d.day}: ${d.observedChannels} of ${d.activeChannels} channels collected`}
              </span>
            </span>
          );
        })}
      </div>

      <p className="mt-2 text-[11px] text-zinc-400 dark:text-zinc-500">
        {'Oldest to newest. The dashed square is today, which is still open until midnight. '}
        {!hasScheduledClosedDays
          ? 'Gray days are before collection began; they are historical context, not failed runs.'
          : missed.length > 0
          ? 'Incomplete days are listed as measurement notes on any report covering them.'
          : 'A sweep re-queues anything uncollected at 8pm and 10pm, while the day can still be saved.'}
      </p>
    </div>
  );
}
