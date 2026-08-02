'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { CircleAlert, Loader2, RefreshCw, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Tooltip } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';
import { daysIn, parseRangeParams } from '@/lib/dates';
import { PLATFORMS, type Platform } from '@/lib/types';
import { useUrlState } from '@/components/common/use-url-state';
import { RefreshOverlay } from './refresh-overlay';
import {
  mergeRefreshSummaries,
  type RefreshRunSummary,
} from './refresh-summary';

/**
 * The cap is a product fact, not an implementation detail.
 *
 * One server request stays bounded, while one button press drains consecutive
 * batches from the durable landscape queue. If the tab closes, the lease and
 * queue state remain so the next press resumes instead of starting over.
 */
const CHANNEL_CAP = 24;
const MAX_BATCHES_PER_PRESS = 20;
const PLATFORM_SET = new Set<string>(PLATFORMS);

function clock(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return m + ':' + String(s).padStart(2, '0');
}

function plural(count: number, one: string, many: string): string {
  return count + ' ' + (count === 1 ? one : many);
}

export function RefreshButton({
  className,
  landscapeId,
  platforms,
}: {
  className?: string;
  landscapeId: string;
  platforms?: Platform[];
}) {
  const router = useRouter();
  const { searchParams } = useUrlState();
  const sinceDays = Math.min(365, Math.max(1, daysIn(parseRangeParams(
    new URLSearchParams(searchParams.toString()),
  ))));
  const selectedPlatforms = platforms ?? (searchParams.get('platforms') ?? '')
    .split(',')
    .filter((value): value is Platform => PLATFORM_SET.has(value));
  const [running, setRunning] = React.useState(false);
  const [elapsed, setElapsed] = React.useState(0);
  const [summary, setSummary] = React.useState<RefreshRunSummary | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  // The overlay is dismissible, but dismissing it must not cancel the run.
  const [overlayHidden, setOverlayHidden] = React.useState(false);

  // Hold the start time rather than resetting a counter inside the effect.
  // Zeroing elapsed on mount of the interval is a synchronous setState in an
  // effect, which cascades a render; deriving the value from a ref does not.
  const startedAtRef = React.useRef(0);

  React.useEffect(() => {
    if (!running) return undefined;
    const id = window.setInterval(() => {
      setElapsed(Math.floor((Date.now() - startedAtRef.current) / 1000));
    }, 1000);
    return () => window.clearInterval(id);
  }, [running]);

  const run = async () => {
    setOverlayHidden(false);
    startedAtRef.current = Date.now();
    setElapsed(0);
    setRunning(true);
    setSummary(null);
    setError(null);
    try {
      let aggregate: RefreshRunSummary | null = null;
      let latest: RefreshRunSummary | null = null;
      for (let batch = 0; batch < MAX_BATCHES_PER_PRESS; batch += 1) {
        const res = await fetch('/api/ingest/run', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            limit: CHANNEL_CAP,
            sinceDays,
            landscapeId,
            platforms: selectedPlatforms.length > 0 ? selectedPlatforms : undefined,
            enqueue: batch === 0,
          }),
        });
        const payload: unknown = await res.json().catch(() => null);
        if (!res.ok) {
          const envelope = payload as { error?: string } | null;
          throw new Error(envelope?.error ?? 'The refresh failed with status ' + res.status + '.');
        }
        latest = payload as RefreshRunSummary;
        aggregate = mergeRefreshSummaries(aggregate, latest);
        setSummary(aggregate);
        if (latest.complete || latest.remaining <= latest.blocked || latest.attempted === 0) break;
      }
      if (!latest) throw new Error('The refresh returned no collection result.');
      router.refresh();
    } catch (err) {
      setError(
        err instanceof Error && err.message
          ? err.message
          : 'The refresh could not be reached. Check the connection and try again.',
      );
    } finally {
      setRunning(false);
    }
  };

  const firstFailure = summary?.results?.find((result) => (
    result.status === 'failed' || result.status === 'skipped' || result.status === 'partial'
  ) && result.error);

  return (
    <div className={cn('relative', className)}>
      {running && !overlayHidden ? (
        <RefreshOverlay elapsed={elapsed} onCancel={() => setOverlayHidden(true)} />
      ) : null}
      <Tooltip
        content={(
          <span className="block">
            Queues every profile in this landscape for the selected {sinceDays}-day window. This
            request processes {CHANNEL_CAP} at a time and keeps taking batches while this page stays open.
            <span className="mt-1.5 block text-zinc-500 dark:text-zinc-400">
              Expect this first batch to take one to five minutes. Rankings remain locked until every profile finishes.
            </span>
          </span>
        )}
        side="bottom"
        align="end"
        wide
      >
        <Button
          variant="primary"
          size="sm"
          onClick={run}
          disabled={running}
          aria-busy={running}
          className="whitespace-nowrap"
        >
          {running ? (
            <Loader2 className="h-3 w-3 animate-spin" aria-hidden />
          ) : (
            <RefreshCw className="h-3 w-3" aria-hidden />
          )}
          {running ? 'Refreshing' : 'Refresh data'}
          {running ? <span className="pb-num tabular-nums opacity-80">{clock(elapsed)}</span> : null}
        </Button>
      </Tooltip>

      {running ? (
        <p
          role="status"
          className="absolute right-0 top-full z-40 mt-2 w-72 rounded-md border border-zinc-200 bg-white p-3 text-[11px] leading-relaxed text-zinc-500 shadow-lg dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-400"
        >
          {'Processing the first ' + CHANNEL_CAP + ' queued profiles, one platform at a time. '}
          {elapsed < 25
            ? 'This normally takes one to five minutes.'
            : 'Still going. TikTok and Instagram reads alone take up to 110 seconds each.'}
        </p>
      ) : null}

      {!running && (summary || error) ? (
        <div
          role="status"
          className="absolute right-0 top-full z-40 mt-2 w-80 rounded-md border border-zinc-200 bg-white p-3 shadow-lg dark:border-zinc-700 dark:bg-zinc-900"
        >
          <div className="flex items-start gap-2">
            {error ? (
              <CircleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0 text-red-600 dark:text-red-400" aria-hidden />
            ) : null}
            <div className="min-w-0 flex-1">
              {error ? (
                <>
                  <p className="text-xs font-semibold text-zinc-900 dark:text-zinc-100">
                    The refresh did not run
                  </p>
                  <p className="mt-1 text-[11px] leading-relaxed text-red-600 dark:text-red-400">{error}</p>
                </>
              ) : summary ? (
                <>
                  <p className="text-xs font-semibold text-zinc-900 dark:text-zinc-100">
                    {summary.blocked > 0
                      ? plural(summary.blocked, 'profile needs attention', 'profiles need attention')
                      : summary.postsUpserted > 0
                      ? plural(summary.postsUpserted, 'post added or updated', 'posts added or updated')
                      : 'No new posts found'}
                  </p>
                  <dl className="pb-num mt-2 grid grid-cols-4 gap-2 text-[11px]">
                    {[
                      { label: 'Tried', value: summary.attempted },
                      { label: 'Done', value: summary.succeeded },
                      { label: 'Failed', value: summary.failed },
                      { label: 'Skipped', value: summary.skipped },
                    ].map((cell) => (
                      <div key={cell.label}>
                        <dt className="text-[10px] uppercase tracking-wider text-zinc-400">{cell.label}</dt>
                        <dd
                          className={cn(
                            'font-semibold',
                            cell.label === 'Failed' && cell.value > 0
                              ? 'text-red-600 dark:text-red-400'
                              : 'text-zinc-900 dark:text-zinc-100',
                          )}
                        >
                          {cell.value}
                        </dd>
                      </div>
                    ))}
                  </dl>
                  {firstFailure ? (
                    <p className="mt-2 text-[11px] leading-relaxed text-red-600 dark:text-red-400">
                      {firstFailure.companyName + ' on ' + firstFailure.platform + ': '
                        + (firstFailure.error ?? 'no reason given')}
                    </p>
                  ) : null}
                  <p className="mt-2 text-[11px] leading-relaxed text-zinc-500 dark:text-zinc-400">
                    {summary.complete
                      ? 'Every queued profile now covers this window. Took '
                        + clock(Math.round(summary.durationMs / 1000)) + '.'
                      : summary.remaining + ' profiles remain in the durable queue. '
                        + (summary.blocked > 0
                          ? summary.blocked + ' need configuration or vendor attention. '
                          : 'Leave this page open to continue now; closing it is safe and the next refresh resumes. ')
                        + 'This batch took ' + clock(Math.round(summary.durationMs / 1000)) + '.'}
                  </p>
                </>
              ) : null}
            </div>
            <button
              type="button"
              onClick={() => { setSummary(null); setError(null); }}
              aria-label="Dismiss refresh result"
              className="-mr-1 -mt-1 inline-flex h-6 w-6 shrink-0 items-center justify-center rounded text-zinc-400 transition-colors hover:bg-zinc-100 hover:text-zinc-900 dark:hover:bg-zinc-800 dark:hover:text-zinc-100"
            >
              <X className="h-3 w-3" aria-hidden />
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
