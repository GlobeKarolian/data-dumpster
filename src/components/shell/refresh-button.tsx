'use client';

import * as React from 'react';
import { createPortal } from 'react-dom';
import { useRouter } from 'next/navigation';
import {
  CheckCircle2,
  ChevronDown,
  CircleAlert,
  Clock3,
  Loader2,
  X,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Tooltip } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';
import { parseRangeParams, previousRange } from '@/lib/dates';
import type { Platform } from '@/lib/types';
import { ADAPTER_SUPPORTED_PLATFORMS } from '@/lib/adapters/supported-platforms';
import { useUrlState } from '@/components/common/use-url-state';
import { PlatformIcon } from '@/components/ui/platform-icon';
import {
  isActiveRefreshStatus,
  refreshScopeKey,
  type RefreshActivityItem,
  type RefreshJobSnapshot,
} from '@/lib/adapters/refresh-job-contract';
import {
  getActiveRefreshJob,
  getRefreshJob,
  startRefreshJob,
} from './refresh-request';

const PLATFORM_SET = new Set<string>(ADAPTER_SUPPORTED_PLATFORMS);
const POLL_MS = 3_000;

function plural(count: number, one: string, many: string): string {
  return count + ' ' + (count === 1 ? one : many);
}

function platformsFromKey(value: string): Platform[] {
  return value
    .split(',')
    .filter((platform): platform is Platform => PLATFORM_SET.has(platform));
}

function activityStatus(item: RefreshActivityItem): string {
  switch (item.phase) {
    case 'collecting': return 'Worker active';
    case 'queued': return 'Up next';
    case 'waiting': return item.nextAttemptAt
      ? 'Eligible after ' + new Date(item.nextAttemptAt).toLocaleTimeString([], {
          hour: 'numeric', minute: '2-digit',
        })
      : 'Waiting to retry';
    case 'completed': return 'Collected';
    case 'source_limited': return 'Source limited';
    case 'needs_attention': return 'Needs attention';
  }
}

function ActivityRow({ item }: { item: RefreshActivityItem }) {
  const active = item.phase === 'collecting';
  const attention = item.phase === 'needs_attention' || item.phase === 'source_limited';
  return (
    <li className="flex min-w-0 items-center gap-2 py-1.5">
      <PlatformIcon platform={item.platform} className="h-3.5 w-3.5" />
      <div className="min-w-0 flex-1">
        <p className="truncate text-[11px] font-medium text-zinc-800 dark:text-zinc-200">
          {item.companyName}
        </p>
        <p className="truncate text-[10px] text-zinc-400">@{item.handle.replace(/^@/, '')}</p>
      </div>
      <span className={cn(
        'shrink-0 text-[10px] font-medium',
        active
          ? 'text-red-600 dark:text-red-400'
          : attention
            ? 'text-amber-600 dark:text-amber-400'
            : 'text-zinc-400',
      )}>
        {active ? (
          <span className="mr-1 inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-red-600" />
        ) : null}
        {activityStatus(item)}
      </span>
    </li>
  );
}

export function RefreshButton({
  className,
  landscapeId,
  platforms,
  manualRefreshAllowed,
}: {
  className?: string;
  landscapeId: string;
  platforms?: Platform[];
  manualRefreshAllowed: boolean;
}) {
  const router = useRouter();
  const { searchParams } = useUrlState();
  const searchKey = searchParams.toString();
  const selectedRange = parseRangeParams(new URLSearchParams(searchKey));
  // Active-job discovery uses the selected window plus its WoW predecessor so
  // an in-flight legacy/operator job can still be monitored after navigation.
  const requiredSince = previousRange(selectedRange).start.toISOString();
  const requiredUntil = selectedRange.end.toISOString();
  const selectedPlatformKey = platforms?.join(',')
    ?? (new URLSearchParams(searchKey).get('platforms') ?? '');
  const selectedPlatforms = platformsFromKey(selectedPlatformKey);
  const scopeKey = refreshScopeKey(
    landscapeId,
    selectedPlatforms,
    requiredSince,
    requiredUntil,
  );
  const [job, setJob] = React.useState<RefreshJobSnapshot | null>(null);
  const [attachedScope, setAttachedScope] = React.useState<string | null>(null);
  const [panelOpen, setPanelOpen] = React.useState(false);
  const [panelPosition, setPanelPosition] = React.useState({ top: 64, left: 16, maxHeight: 640 });
  const [activityOpen, setActivityOpen] = React.useState(true);
  const [starting, setStarting] = React.useState(false);
  const [startError, setStartError] = React.useState<string | null>(null);
  const anchorRef = React.useRef<HTMLDivElement>(null);
  const refreshedJobs = React.useRef(new Set<string>());
  const scopedJob = attachedScope === scopeKey ? job : null;
  const active = scopedJob ? isActiveRefreshStatus(scopedJob.status) : false;

  const updatePanelPosition = React.useCallback(() => {
    const anchor = anchorRef.current;
    if (!anchor) return;
    const rect = anchor.getBoundingClientRect();
    const width = Math.min(384, window.innerWidth - 32);
    const left = Math.max(16, Math.min(rect.right - width, window.innerWidth - width - 16));
    const top = rect.bottom + 8;
    setPanelPosition({
      top,
      left,
      maxHeight: Math.max(180, window.innerHeight - top - 16),
    });
  }, []);

  const openPanel = React.useCallback(() => {
    updatePanelPosition();
    setPanelOpen(true);
  }, [updatePanelPosition]);

  React.useEffect(() => {
    if (!panelOpen) return undefined;
    const reposition = () => updatePanelPosition();
    window.addEventListener('resize', reposition);
    window.addEventListener('scroll', reposition, true);
    return () => {
      window.removeEventListener('resize', reposition);
      window.removeEventListener('scroll', reposition, true);
    };
  }, [panelOpen, updatePanelPosition]);

  const acceptJob = React.useCallback((next: RefreshJobSnapshot | null) => {
    setJob(next);
    setAttachedScope(scopeKey);
    if (next && !isActiveRefreshStatus(next.status)) {
      if (!refreshedJobs.current.has(next.id)) {
        refreshedJobs.current.add(next.id);
        router.refresh();
      }
    }
  }, [router, scopeKey]);

  // A job belongs to its canonical landscape/platform scope. Rediscover it on
  // navigation rather than carrying the prior landscape's progress forward.
  React.useEffect(() => {
    const controller = new AbortController();
    const queryPlatforms = platformsFromKey(selectedPlatformKey);
    void getActiveRefreshJob({
      landscapeId,
      since: requiredSince,
      until: requiredUntil,
      platforms: queryPlatforms.length > 0 ? queryPlatforms : undefined,
    }, { signal: controller.signal }).then((found) => {
      if (!controller.signal.aborted) {
        // Attach silently. The pill in the top bar already reports progress;
        // auto-expanding the full panel on every page load hogged the screen
        // for the entire duration of a refresh. The panel opens on click.
        acceptJob(found);
      }
    }).catch((cause: unknown) => {
      if (cause instanceof Error && cause.name === 'AbortError') return;
      // Discovery is best-effort. A failed read must not make a perfectly
      // usable refresh button look broken before the user touches it.
    });
    return () => controller.abort();
  }, [acceptJob, landscapeId, openPanel, requiredSince, requiredUntil, scopeKey, selectedPlatformKey]);

  React.useEffect(() => {
    if (!scopedJob || !isActiveRefreshStatus(scopedJob.status)) return undefined;
    let stopped = false;
    let timer: number | undefined;
    let controller: AbortController | null = null;

    const schedule = (delay = POLL_MS) => {
      if (stopped) return;
      timer = window.setTimeout(() => { void poll(); }, delay);
    };
    const poll = async () => {
      if (stopped) return;
      if (document.visibilityState === 'hidden') {
        schedule(15_000);
        return;
      }
      controller = new AbortController();
      try {
        const latest = await getRefreshJob(scopedJob.id, { signal: controller.signal });
        if (stopped) return;
        acceptJob(latest);
        if (isActiveRefreshStatus(latest.status)) schedule();
      } catch (cause) {
        if (stopped || (cause instanceof Error && cause.name === 'AbortError')) return;
        // A transient polling error should not turn a healthy background job
        // red. Keep trying; the durable queue is independent of this browser.
        schedule(8_000);
      }
    };
    const onVisibility = () => {
      if (document.visibilityState !== 'visible') return;
      if (timer) window.clearTimeout(timer);
      void poll();
    };
    document.addEventListener('visibilitychange', onVisibility);
    schedule();
    return () => {
      stopped = true;
      if (timer) window.clearTimeout(timer);
      controller?.abort();
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [acceptJob, scopedJob]);

  const run = async () => {
    openPanel();
    setActivityOpen(true);
    if (!manualRefreshAllowed || active || starting) return;

    setStarting(true);
    setStartError(null);
    try {
      const started = await startRefreshJob({
        landscapeId,
        since: requiredSince,
        until: requiredUntil,
        platforms: selectedPlatforms.length > 0 ? selectedPlatforms : undefined,
      });
      acceptJob(started);
    } catch (cause) {
      setStartError(cause instanceof Error ? cause.message : 'The refresh could not be started.');
    } finally {
      setStarting(false);
    }
  };

  const buttonLabel = active && scopedJob
    ? 'Refreshing · ' + scopedJob.settled + '/' + scopedJob.total
    : starting
      ? 'Starting refresh…'
      : manualRefreshAllowed
        ? 'Refresh now'
        : 'Automatic · 2× daily';
  const liveSummary = scopedJob
    ? scopedJob.settled + ' of ' + scopedJob.total + ' profiles settled.'
    : 'Automatic refresh is scheduled twice daily.';

  return (
    <div ref={anchorRef} className={cn('relative w-[12.25rem] shrink-0', className)}>
      <Tooltip
        content={(
          <span className="block">
            {manualRefreshAllowed
              ? 'Start a manual refresh for the selected landscape and date window.'
              : 'Public profile data refreshes automatically twice daily.'}
            <span className="mt-1.5 block text-zinc-500 dark:text-zinc-400">
              {manualRefreshAllowed
                ? 'Paid source calls are pooled and an active refresh is reused instead of duplicated.'
                : 'Pending receipts and retries resume in the background without opening another refresh window.'}
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
          onClick={() => { void run(); }}
          aria-label={manualRefreshAllowed ? 'Refresh data now' : 'Automatic refresh status'}
          aria-busy={active || starting}
          disabled={starting}
          className="w-full justify-center whitespace-nowrap"
        >
          {active || starting ? (
            <Loader2 className="h-3 w-3 animate-spin" aria-hidden />
          ) : (
            <Clock3 className="h-3 w-3" aria-hidden />
          )}
          <span className="pb-num">{buttonLabel}</span>
        </Button>
      </Tooltip>

      {panelOpen && typeof document !== 'undefined'
        ? createPortal((
        <div
          role="region"
          aria-label="Refresh progress"
          className="fixed z-[100] w-[min(24rem,calc(100vw-2rem))] overflow-y-auto rounded-md border border-zinc-200 bg-white p-3 shadow-lg dark:border-zinc-700 dark:bg-zinc-900"
          style={panelPosition}
        >
          <p className="sr-only" aria-live="polite">{liveSummary}</p>
          <div className="flex items-start gap-2">
            {active ? (
              <Loader2 className="mt-0.5 h-3.5 w-3.5 shrink-0 animate-spin text-red-600 dark:text-red-400" aria-hidden />
            ) : scopedJob?.status === 'failed' || scopedJob?.status === 'completed_with_issues' ? (
              <CircleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-600 dark:text-amber-400" aria-hidden />
            ) : scopedJob?.status === 'completed' ? (
              <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-600 dark:text-emerald-400" aria-hidden />
            ) : (
              <Clock3 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-zinc-400" aria-hidden />
            )}
            <div className="min-w-0 flex-1">
              <p className="text-xs font-semibold text-zinc-900 dark:text-zinc-100">
                {starting
                  ? 'Starting manual refresh'
                  : active && scopedJob
                  ? 'Refreshing ' + plural(scopedJob.total, 'profile', 'profiles')
                  : scopedJob?.status === 'completed'
                    ? 'Refresh complete'
                    : scopedJob?.status === 'completed_with_issues'
                      ? 'Refresh finished with notes'
                      : 'Automatic refresh is on'}
              </p>

              {startError ? (
                <p className="mt-2 rounded bg-red-50 px-2 py-1.5 text-[11px] leading-relaxed text-red-700 dark:bg-red-950/30 dark:text-red-300">
                  {startError}
                </p>
              ) : null}

              {scopedJob ? (
                <>
                  <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-zinc-100 dark:bg-zinc-800">
                    <div
                      className="h-full rounded-full bg-red-600 transition-[width] duration-500"
                      style={{ width: (scopedJob.total > 0 ? (scopedJob.settled / scopedJob.total) * 100 : 100) + '%' }}
                    />
                  </div>
                  <p className="pb-num mt-2 text-[11px] leading-relaxed text-zinc-600 dark:text-zinc-300">
                    {scopedJob.settled + ' of ' + scopedJob.total + ' settled'}
                    {scopedJob.running > 0 ? ' · ' + scopedJob.running + ' in progress' : ''}
                    {scopedJob.waitingForRetry > 0 ? ' · ' + scopedJob.waitingForRetry + ' waiting to retry' : ''}
                  </p>
                  {scopedJob.blocked > 0 || scopedJob.sourceLimited > 0 ? (
                    <p className="mt-1 text-[11px] leading-relaxed text-amber-700 dark:text-amber-300">
                      {scopedJob.blocked > 0
                        ? plural(scopedJob.blocked, 'profile needs attention', 'profiles need attention')
                        : ''}
                      {scopedJob.blocked > 0 && scopedJob.sourceLimited > 0 ? ' · ' : ''}
                      {scopedJob.sourceLimited > 0
                        ? plural(scopedJob.sourceLimited, 'source-limited profile', 'source-limited profiles')
                        : ''}
                    </p>
                  ) : null}
                  {scopedJob.lastError ? (
                    <p className="mt-1 text-[11px] leading-relaxed text-red-600 dark:text-red-400">
                      {scopedJob.lastError}
                    </p>
                  ) : null}
                  {active ? (
                    <p className="mt-2 text-[11px] leading-relaxed text-zinc-500 dark:text-zinc-400">
                      The refresh continues in the background. You can leave this page safely.
                    </p>
                  ) : null}

                  <div className="mt-3 border-t border-zinc-100 pt-2 dark:border-zinc-800">
                    <button
                      type="button"
                      onClick={() => setActivityOpen((open) => !open)}
                      aria-expanded={activityOpen}
                      className="flex w-full items-center justify-between gap-3 text-left"
                    >
                      <span>
                        <span className="block text-[11px] font-semibold text-zinc-800 dark:text-zinc-200">
                          Live activity
                        </span>
                        <span className="block text-[10px] text-zinc-400">
                          {active ? 'Updating every 3 seconds' : 'Final worker activity'}
                        </span>
                      </span>
                      <ChevronDown className={cn(
                        'h-3.5 w-3.5 text-zinc-400 transition-transform',
                        activityOpen && 'rotate-180',
                      )} aria-hidden />
                    </button>

                    {activityOpen ? (
                      <div className="mt-2">
                        {scopedJob.activity.collecting.length > 0 ? (
                          <section>
                            <p className="text-[9px] font-semibold uppercase tracking-wider text-zinc-400">
                              Worker active now
                            </p>
                            <ul className="divide-y divide-zinc-100 dark:divide-zinc-800">
                              {scopedJob.activity.collecting.map((item) => (
                                <ActivityRow key={item.channelId} item={item} />
                              ))}
                            </ul>
                          </section>
                        ) : active && scopedJob.lastError ? (
                          <p className="rounded bg-amber-50 px-2 py-1.5 text-[10px] text-amber-700 dark:bg-amber-950/30 dark:text-amber-300">
                            Waiting for the scheduled recovery worker. No profiles were dropped.
                          </p>
                        ) : active ? (
                          <p className="rounded bg-zinc-50 px-2 py-1.5 text-[10px] text-zinc-500 dark:bg-zinc-800/60 dark:text-zinc-400">
                            Preparing the next worker wave.
                          </p>
                        ) : null}

                        {scopedJob.activity.queuedNext.length > 0 ? (
                          <section className="mt-2">
                            <p className="text-[9px] font-semibold uppercase tracking-wider text-zinc-400">
                              Queued next
                            </p>
                            <ul className="divide-y divide-zinc-100 dark:divide-zinc-800">
                              {scopedJob.activity.queuedNext.map((item) => (
                                <ActivityRow key={item.channelId} item={item} />
                              ))}
                            </ul>
                          </section>
                        ) : null}

                        {Math.max(
                          0,
                          scopedJob.remaining
                            - scopedJob.activity.collecting.length
                            - scopedJob.activity.queuedNext.length,
                        ) > 0 ? (
                          <p className="mt-1 text-[10px] text-zinc-400">
                            {'+ ' + plural(
                              Math.max(
                                0,
                                scopedJob.remaining
                                  - scopedJob.activity.collecting.length
                                  - scopedJob.activity.queuedNext.length,
                              ),
                              'more profile safely queued',
                              'more profiles safely queued',
                            )}
                          </p>
                        ) : null}

                        {scopedJob.activity.recent.length > 0 ? (
                          <section className="mt-2">
                            <p className="text-[9px] font-semibold uppercase tracking-wider text-zinc-400">
                              Recently settled
                            </p>
                            <ul className="divide-y divide-zinc-100 dark:divide-zinc-800">
                              {scopedJob.activity.recent.map((item) => (
                                <ActivityRow key={item.channelId} item={item} />
                              ))}
                            </ul>
                          </section>
                        ) : null}
                      </div>
                    ) : null}
                  </div>
                </>
              ) : starting ? (
                <p className="mt-2 text-[11px] leading-relaxed text-zinc-500 dark:text-zinc-400">
                  Registering the landscape profiles in the durable collection queue.
                </p>
              ) : (
                <div className="mt-1 space-y-2 text-[11px] leading-relaxed text-zinc-500 dark:text-zinc-400">
                  <p>
                    New collection windows open every 12 hours, in the morning and evening.
                  </p>
                  <p>
                    Recovery workers only resume profiles already queued for collection. They do not create a third normal refresh or repay for settled data.
                  </p>
                </div>
              )}
            </div>
            <button
              type="button"
              onClick={() => setPanelOpen(false)}
              aria-label="Dismiss refresh status"
              className="-mr-1 -mt-1 inline-flex h-6 w-6 shrink-0 items-center justify-center rounded text-zinc-400 transition-colors hover:bg-zinc-100 hover:text-zinc-900 dark:hover:bg-zinc-800 dark:hover:text-zinc-100"
            >
              <X className="h-3 w-3" aria-hidden />
            </button>
          </div>
        </div>
        ), document.body)
        : null}
    </div>
  );
}
