/**
 * Backlog progress for the tagging pipeline.
 *
 * The bar reports posts the model has READ, not posts that ended up with a
 * tag. Those differ by roughly half, because plenty of posts legitimately match
 * nothing, and showing the tagged count as progress would make a finished
 * corpus look permanently half-done. Both numbers are on screen so neither is
 * mistaken for the other.
 */
import { PLATFORM_LABELS, type Platform } from '@/lib/types';
import type { TagProgress } from '@/lib/tagging/activity';

function compact(n: number): string {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + 'M';
  if (n >= 1_000) return (n / 1_000).toFixed(n >= 10_000 ? 0 : 1) + 'k';
  return String(n);
}

function Stat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="rounded-lg border border-zinc-200/70 bg-white px-3 py-2.5 dark:border-zinc-800 dark:bg-zinc-900/40">
      <div className="text-[10px] font-semibold uppercase tracking-wide text-zinc-400">{label}</div>
      <div className="pb-num mt-0.5 text-lg font-semibold tabular-nums text-zinc-900 dark:text-zinc-100">{value}</div>
      {sub ? <div className="text-[11px] text-zinc-500">{sub}</div> : null}
    </div>
  );
}

export function TaggingProgress({ progress }: { progress: TagProgress }) {
  const {
    totalPosts, processedPosts, taggedPosts, pctProcessed,
    throughput, platforms, spendToday, perPost7d,
    blockedCount, blockedReason, blockedIsBilling,
  } = progress;
  const remaining = Math.max(0, totalPosts - processedPosts);
  const peak = throughput.reduce((m, b) => Math.max(m, b.posts), 0);
  const lastHour = throughput.length ? throughput[throughput.length - 1].posts : 0;
  // Only project a finish when there is recent movement to project from.
  const etaHours = lastHour > 0 ? remaining / lastHour : null;
  const projectedUsd = perPost7d != null ? remaining * perPost7d : null;

  return (
    <div className="space-y-4">
      {/*
        A stalled reader and a finished one draw the same progress bar. Credits
        ran out at 06:00 on August 24 and the only record of it was a database
        column nobody read, so the page showed a bar that had simply stopped
        moving. It says so now, at the top, before any of the numbers.
      */}
      {blockedCount > 0 && blockedReason ? (
        <div className="rounded-xl border border-red-300 bg-red-50/70 p-4 dark:border-red-900/60 dark:bg-red-950/20">
          <p className="text-sm font-semibold text-red-900 dark:text-red-200">
            {blockedIsBilling
              ? 'The reader is stopped: the model provider is out of credits.'
              : 'The reader is failing.'}
          </p>
          <p className="mt-1 text-xs leading-relaxed text-red-800 dark:text-red-300">
            {compact(blockedCount) + ' posts failed in the last six hours. '
              + (blockedIsBilling
                ? 'Add credit to the provider account and the queue resumes on its own; '
                  + 'nothing needs to be re-run by hand. '
                : '')}
            {'Provider said: ' + blockedReason}
          </p>
        </div>
      ) : null}
      <div className="rounded-xl border border-zinc-200/70 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900/40">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">Corpus coverage</h2>
          <span className="pb-num text-sm tabular-nums text-zinc-500">
            {compact(processedPosts)} of {compact(totalPosts)} posts read
            <span className="ml-2 font-semibold text-zinc-900 dark:text-zinc-100">
              {pctProcessed.toFixed(1)}%
            </span>
          </span>
        </div>

        <div className="mt-3 h-3 w-full overflow-hidden rounded-full bg-zinc-100 dark:bg-zinc-800">
          <div
            className="h-full rounded-full bg-gradient-to-r from-red-500 to-red-700 transition-[width] duration-700"
            style={{ width: Math.min(100, Math.max(0.5, pctProcessed)) + '%' }}
            role="progressbar"
            aria-valuenow={Math.round(pctProcessed)}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-label="Share of posts read by the tagging model"
          />
        </div>

        <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
          <Stat label="Read" value={compact(processedPosts)} sub="model has seen" />
          <Stat label="Tagged" value={compact(taggedPosts)}
            sub={processedPosts > 0 ? Math.round((taggedPosts / processedPosts) * 100) + '% of read' : undefined} />
          <Stat label="Remaining" value={compact(remaining)}
            sub={etaHours != null ? '~' + (etaHours < 1 ? '<1' : Math.ceil(etaHours)) + 'h at current rate' : 'idle'} />
          <Stat label="Spend today" value={'$' + spendToday.toFixed(2)}
            sub={projectedUsd != null ? '~$' + projectedUsd.toFixed(0) + ' to finish' : undefined} />
        </div>
      </div>

      <div className="rounded-xl border border-zinc-200/70 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900/40">
        <div className="flex items-baseline justify-between gap-2">
          <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">Throughput</h2>
          <span className="text-xs text-zinc-500">Posts read per hour, last 24h</span>
        </div>
        {throughput.length === 0 ? (
          <p className="mt-3 text-xs text-zinc-500">No posts read in the last 24 hours.</p>
        ) : (
          <div className="mt-3 flex h-28 items-end gap-[3px]">
            {throughput.map((b) => (
              <div
                key={b.hour}
                className="group relative flex-1 rounded-t bg-red-500/80 transition-colors hover:bg-red-600 dark:bg-red-500/70"
                style={{ height: Math.max(2, peak > 0 ? (b.posts / peak) * 100 : 0) + '%' }}
              >
                <span className="pointer-events-none absolute bottom-full left-1/2 z-10 mb-1 hidden -translate-x-1/2 whitespace-nowrap rounded bg-zinc-900 px-1.5 py-1 text-[10px] font-medium text-white group-hover:block">
                  {b.hour.slice(11)} · {b.posts.toLocaleString()} posts
                </span>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="rounded-xl border border-zinc-200/70 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900/40">
        <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">Coverage by platform</h2>
        <ul className="mt-3 space-y-2">
          {platforms.map((p) => {
            const pct = p.total > 0 ? (p.done / p.total) * 100 : 0;
            const label = PLATFORM_LABELS[p.platform as Platform] ?? p.platform;
            return (
              <li key={p.platform} className="flex items-center gap-3">
                <span className="w-24 shrink-0 truncate text-xs text-zinc-600 dark:text-zinc-400">{label}</span>
                <span className="h-2 flex-1 overflow-hidden rounded-full bg-zinc-100 dark:bg-zinc-800">
                  <span className="block h-full rounded-full bg-red-500/80 transition-[width] duration-700"
                    style={{ width: Math.max(0, pct) + '%' }} />
                </span>
                <span className="pb-num w-28 shrink-0 text-right text-[11px] tabular-nums text-zinc-500">
                  {compact(p.done)}/{compact(p.total)} · {pct.toFixed(0)}%
                </span>
              </li>
            );
          })}
        </ul>
      </div>
    </div>
  );
}
