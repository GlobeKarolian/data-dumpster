'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { CalendarRange, Loader2, Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { lastCompleteWeek } from '@/lib/reports/types';

const DATE_INPUT = 'pb-num h-7 rounded-md border border-zinc-200 bg-white px-2 text-xs text-zinc-800 '
  + 'transition-colors focus:border-accent-600 focus:outline-none '
  + 'dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-200';

/**
 * Start a report for the week that just ended.
 *
 * The default window is the last complete Monday to Sunday, never a window that
 * includes today. The weekly is written about a finished week, and a partial
 * week averaged into a weekly figure is the exact error this tool exists to
 * remove -- so the correct default is the only one on offer until the author
 * deliberately changes it.
 */
export function NewReportButton({ landscapeId }: { landscapeId: string }) {
  const router = useRouter();
  const fallback = React.useMemo(() => lastCompleteWeek(), []);
  const [start, setStart] = React.useState(fallback.start);
  const [end, setEnd] = React.useState(fallback.end);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const create = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch('/api/reports', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ landscapeId, periodStart: start, periodEnd: end }),
      });
      const payload: unknown = await res.json().catch(() => null);
      if (!res.ok) {
        const message = typeof payload === 'object' && payload !== null && 'error' in payload
          ? String((payload as { error: unknown }).error)
          : 'The report could not be created (status ' + res.status + ').';
        throw new Error(message);
      }
      const id = typeof payload === 'object' && payload !== null && 'id' in payload
        ? String((payload as { id: unknown }).id)
        : null;
      if (id) router.push(
        '/reports/' + id + '?landscape=' + encodeURIComponent(landscapeId),
      );
      else router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'The report could not be created.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col items-end gap-1.5">
      <div className="flex flex-wrap items-center justify-end gap-2">
        <span className="inline-flex items-center gap-1.5 text-[11px] text-zinc-500 dark:text-zinc-400">
          <CalendarRange className="h-3 w-3" aria-hidden />
          Week
        </span>
        <input
          type="date"
          value={start}
          max={end}
          onChange={(e) => setStart(e.target.value)}
          aria-label="Report period start"
          className={DATE_INPUT}
        />
        <input
          type="date"
          value={end}
          min={start}
          onChange={(e) => setEnd(e.target.value)}
          aria-label="Report period end"
          className={DATE_INPUT}
        />
        <Button variant="primary" size="sm" onClick={create} disabled={busy}>
          {busy
            ? <Loader2 className="h-3 w-3 animate-spin" aria-hidden />
            : <Plus className="h-3 w-3" aria-hidden />}
          {busy ? 'Computing' : 'New report for this week'}
        </Button>
      </div>
      {error ? (
        <p className="max-w-sm text-right text-[11px] leading-relaxed text-red-600 dark:text-red-400">
          {error}
        </p>
      ) : null}
    </div>
  );
}
