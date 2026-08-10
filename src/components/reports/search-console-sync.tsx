'use client';

import * as React from 'react';
import { AlertTriangle, CheckCircle2, ExternalLink, Link2, Loader2, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  SEARCH_DASHBOARDS,
  parseSearchDashboardUrl,
  sourceUrlFor,
  type SearchTableId,
} from '@/lib/reports/search-console-sources';
import type { Period } from '@/lib/reports/types';

export function SearchConsoleSync({
  period,
  configured,
  disabled,
  busy,
  error,
  syncedAt,
  sources,
  onSourceChange,
  onSync,
}: {
  period: Period;
  configured: boolean;
  disabled?: boolean;
  busy: boolean;
  error: string | null;
  syncedAt: string | null;
  sources: Partial<Record<SearchTableId, string>>;
  onSourceChange: (id: SearchTableId, value: string) => void;
  onSync: () => void;
}) {
  return (
    <div className="rounded-lg border border-sky-200 bg-sky-50/60 p-4 dark:border-sky-900/60 dark:bg-sky-950/20">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <h3 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">Google Web Search</h3>
            {syncedAt ? (
              <span className="inline-flex items-center gap-1 text-[11px] font-medium text-emerald-700 dark:text-emerald-400">
                <CheckCircle2 className="h-3 w-3" aria-hidden /> Synced
              </span>
            ) : null}
          </div>
          <p className="mt-1 max-w-2xl text-xs leading-relaxed text-zinc-600 dark:text-zinc-400">
            Top 20 Web Search queries for {period.start} through {period.end}, sorted by URL clicks,
            for Globe.com and Boston.com.
          </p>
        </div>
        <Button type="button" variant="primary" size="sm" disabled={disabled || busy || !configured} onClick={onSync}>
          {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> : <RefreshCw className="h-3.5 w-3.5" aria-hidden />}
          {busy ? 'Pulling Google data…' : configured ? 'Pull report dates' : 'Google connection required'}
        </Button>
      </div>
      {!configured ? (
        <div className="mt-3 flex gap-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs leading-relaxed text-amber-900 dark:border-amber-900/60 dark:bg-amber-950/30 dark:text-amber-200">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
          <p>
            Automatic Google pull is not connected yet. These links open and document the Looker Studio sources,
            but a pasted report link does not grant Search Console data access. Take screenshots of each table and
            drop them into the matching section below; the browser will extract editable rows for review.
          </p>
        </div>
      ) : null}
      <div className="mt-4 grid gap-3 lg:grid-cols-2">
        {(Object.entries(SEARCH_DASHBOARDS) as Array<[SearchTableId, (typeof SEARCH_DASHBOARDS)[SearchTableId]]>)
          .map(([id, dashboard]) => {
            const value = sources[id]?.trim() || dashboard.url;
            const parsed = parseSearchDashboardUrl(value);
            const href = sourceUrlFor(id, value);
            return (
              <label key={id} className="block rounded-md border border-sky-200 bg-white/75 p-3 dark:border-sky-900/60 dark:bg-zinc-950/40">
                <span className="flex items-center justify-between gap-3 text-xs font-semibold text-zinc-800 dark:text-zinc-200">
                  <span className="inline-flex items-center gap-1.5"><Link2 className="h-3.5 w-3.5" aria-hidden />{dashboard.label}</span>
                  <a
                    href={href}
                    target="_blank"
                    rel="noreferrer"
                    onClick={(event) => event.stopPropagation()}
                    className="inline-flex shrink-0 items-center gap-1 font-medium text-sky-700 hover:underline dark:text-sky-400"
                  >
                    Open<ExternalLink className="h-3 w-3" aria-hidden />
                  </a>
                </span>
                <input
                  type="url"
                  value={value}
                  disabled={disabled}
                  onChange={(event) => onSourceChange(id, event.target.value)}
                  aria-invalid={!parsed}
                  className="mt-2 w-full rounded-md border border-zinc-200 bg-white px-2.5 py-2 text-xs text-zinc-700 outline-none focus:border-sky-500 dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-300"
                />
                <span className={parsed
                  ? 'mt-1.5 block text-[10px] text-emerald-700 dark:text-emerald-400'
                  : 'mt-1.5 block text-[10px] text-red-600 dark:text-red-400'}>
                  {parsed
                    ? parsed.kind === 'report'
                      ? 'Looker Studio report ready · ' + parsed.reportId.slice(0, 8) + '…'
                      : 'Google short report link ready'
                    : 'Paste a Google Looker Studio report URL.'}
                </span>
              </label>
            );
          })}
      </div>
      {error ? (
        <p role="alert" className="mt-3 rounded-md border border-red-200 bg-white px-3 py-2 text-xs text-red-700 dark:border-red-900/60 dark:bg-zinc-950/50 dark:text-red-400">
          {error}
        </p>
      ) : null}
    </div>
  );
}
