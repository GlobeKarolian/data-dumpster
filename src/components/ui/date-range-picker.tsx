'use client';

import * as React from 'react';
import { CalendarDays, Check, ChevronDown } from 'lucide-react';
import { PRESETS, parseLocalDay, toDayString } from '@/lib/dates';
import { cn } from '@/lib/utils';
import { useUrlState } from '@/components/common/use-url-state';
import { Popover, PopoverTriggerSurface } from './popover';

function iso(d: Date): string {
  return toDayString(d);
}

function label(startIso: string | null, endIso: string | null, preset: string | null): string {
  if (startIso && endIso) {
    const fmt = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
    const s = parseLocalDay(startIso);
    const e = parseLocalDay(endIso);
    if (s && e) return fmt.format(s) + ' – ' + fmt.format(e);
  }
  const found = PRESETS.find((p) => p.id === preset);
  return found ? found.label : 'Last 28 days';
}

/**
 * Date range control. Presets come from lib/dates so the windows the UI offers
 * are exactly the windows the query engine knows how to compare against, and
 * the selection is written to the URL so a shared link keeps its window.
 */
export function DateRangePicker({ className }: { className?: string }) {
  const { searchParams, setParams } = useUrlState();
  const preset = searchParams.get('range');
  const startIso = searchParams.get('start');
  const endIso = searchParams.get('end');

  const [draftStart, setDraftStart] = React.useState(startIso ?? '');
  const [draftEnd, setDraftEnd] = React.useState(endIso ?? '');
  const [applied, setApplied] = React.useState({ startIso, endIso });
  const today = iso(new Date());

  // Adjusting state during render rather than in an effect: when the URL window
  // changes underneath us the draft fields follow it in the same pass, with no
  // intermediate frame showing the previous range.
  if (applied.startIso !== startIso || applied.endIso !== endIso) {
    setApplied({ startIso, endIso });
    setDraftStart(startIso ?? '');
    setDraftEnd(endIso ?? '');
  }

  const custom = Boolean(startIso && endIso);
  const activePreset = custom ? null : (preset ?? '28d');
  const invalid = Boolean(draftStart && draftEnd && draftStart > draftEnd);

  return (
    <Popover
      label="Date range"
      align="end"
      className={cn('w-auto', className)}
      panelClassName="w-72"
      trigger={({ open }) => (
        <PopoverTriggerSurface open={open} className="w-auto whitespace-nowrap">
          <CalendarDays className="h-3.5 w-3.5 shrink-0 text-zinc-400" aria-hidden />
          <span className="text-xs">{label(startIso, endIso, preset)}</span>
          <ChevronDown className="h-3.5 w-3.5 shrink-0 text-zinc-400" aria-hidden />
        </PopoverTriggerSurface>
      )}
    >
      {({ close }) => (
        <div>
          <div className="p-1">
            {PRESETS.map((p) => {
              const on = activePreset === p.id;
              return (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => {
                    setParams({ range: p.id, start: null, end: null });
                    close();
                  }}
                  className={cn(
                    'flex w-full items-center justify-between rounded px-2 py-1.5 text-left text-xs transition-colors',
                    'hover:bg-zinc-100 dark:hover:bg-zinc-800',
                    on ? 'text-zinc-900 dark:text-zinc-100' : 'text-zinc-600 dark:text-zinc-400',
                  )}
                >
                  {p.label}
                  {on ? <Check className="h-3 w-3 text-accent-600" aria-hidden /> : null}
                </button>
              );
            })}
          </div>

          <div className="border-t border-zinc-200 p-3 dark:border-zinc-700">
            <p className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-zinc-400 dark:text-zinc-500">
              Custom range
            </p>
            <div className="flex items-center gap-2">
              <label className="min-w-0 flex-1">
                <span className="sr-only">Start date</span>
                <input
                  type="date"
                  value={draftStart}
                  max={draftEnd || today}
                  onChange={(e) => setDraftStart(e.target.value)}
                  className="h-7 w-full rounded border border-zinc-200 bg-transparent px-1.5 text-xs outline-none focus:border-accent-600 dark:border-zinc-700 dark:[color-scheme:dark]"
                />
              </label>
              <span className="text-xs text-zinc-400">to</span>
              <label className="min-w-0 flex-1">
                <span className="sr-only">End date</span>
                <input
                  type="date"
                  value={draftEnd}
                  min={draftStart || undefined}
                  max={today}
                  onChange={(e) => setDraftEnd(e.target.value)}
                  className="h-7 w-full rounded border border-zinc-200 bg-transparent px-1.5 text-xs outline-none focus:border-accent-600 dark:border-zinc-700 dark:[color-scheme:dark]"
                />
              </label>
            </div>
            {invalid ? (
              <p className="mt-2 text-[11px] text-red-600 dark:text-red-400">
                The start date has to fall on or before the end date.
              </p>
            ) : (
              <p className="mt-2 text-[11px] leading-relaxed text-zinc-500">
                Every delta on screen compares this window against the window of equal length
                immediately before it.
              </p>
            )}
            <button
              type="button"
              disabled={!draftStart || !draftEnd || invalid}
              onClick={() => {
                setParams({ start: draftStart, end: draftEnd, range: null });
                close();
              }}
              className="mt-2 inline-flex h-7 w-full items-center justify-center rounded-md bg-accent-600 px-2 text-xs font-medium text-white transition-colors hover:bg-accent-700 disabled:cursor-not-allowed disabled:opacity-50"
            >
              Apply custom range
            </button>
          </div>
        </div>
      )}
    </Popover>
  );
}
