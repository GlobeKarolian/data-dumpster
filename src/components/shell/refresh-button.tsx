'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { CircleAlert, Loader2, RefreshCw, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Tooltip } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';
import { RefreshOverlay } from './refresh-overlay';

/**
 * The cap is a product fact, not an implementation detail.
 *
 * One press refreshes the stalest channels and stops, because a serverless
 * request has a ceiling and a partial refresh that returns beats a complete one
 * that times out. A user who expects every channel and counts twenty-four will
 * conclude the button is broken, so the number is printed in the tooltip and
 * again in the result.
 */
const CHANNEL_CAP = 24;
const SINCE_DAYS = 14;

interface ChannelResult {
  companyName: string;
  handle: string;
  platform: string;
  status: string;
  error?: string;
}

interface RunSummary {
  attempted: number;
  succeeded: number;
  failed: number;
  skipped: number;
  postsUpserted: number;
  durationMs: number;
  results?: ChannelResult[];
}

function clock(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return m + ':' + String(s).padStart(2, '0');
}

function plural(count: number, one: string, many: string): string {
  return count + ' ' + (count === 1 ? one : many);
}

const TOOLTIP = (
  <span className="block">
    Reads the last {SINCE_DAYS} days from the {CHANNEL_CAP} stalest channels and stops there. That cap
    is deliberate: a full pass over every channel does not fit in one request. Press again to reach the
    next batch.
    <span className="mt-1.5 block text-zinc-500 dark:text-zinc-400">
      Expect one to five minutes. TikTok and Instagram take 30 to 110 seconds each on their own.
    </span>
  </span>
);

export function RefreshButton({ className }: { className?: string }) {
  const router = useRouter();
  const [running, setRunning] = React.useState(false);
  const [elapsed, setElapsed] = React.useState(0);
  const [summary, setSummary] = React.useState<RunSummary | null>(null);
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
      const res = await fetch('/api/ingest/run', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ limit: CHANNEL_CAP, sinceDays: SINCE_DAYS }),
      });
      const payload: unknown = await res.json().catch(() => null);
      if (!res.ok) {
        const envelope = payload as { error?: string } | null;
        throw new Error(envelope?.error ?? 'The refresh failed with status ' + res.status + '.');
      }
      setSummary(payload as RunSummary);
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

  const firstFailure = summary?.results?.find((r) => r.status === 'failed');

  return (
    <div className={cn('relative', className)}>
      {running && !overlayHidden ? (
        <RefreshOverlay elapsed={elapsed} onCancel={() => setOverlayHidden(true)} />
      ) : null}
      <Tooltip content={TOOLTIP} side="bottom" align="end" wide>
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
          {'Reading the ' + CHANNEL_CAP + ' stalest channels, one platform at a time. '}
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
                    {summary.postsUpserted > 0
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
                    {'One press refreshes at most ' + CHANNEL_CAP
                      + ' channels, stalest first, so this was a slice and not the whole set. Press again to reach the next batch. Took '
                      + clock(Math.round(summary.durationMs / 1000)) + '.'}
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
