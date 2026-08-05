'use client';

import * as React from 'react';
import { CheckCircle2, ExternalLink, Loader2, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { SEARCH_DASHBOARDS } from '@/lib/reports/search-console-sources';
import type { Period } from '@/lib/reports/types';

export function SearchConsoleSync({
  period,
  disabled,
  busy,
  error,
  syncedAt,
  onSync,
}: {
  period: Period;
  disabled?: boolean;
  busy: boolean;
  error: string | null;
  syncedAt: string | null;
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
            Pulls the top 100 Web Search queries for {period.start} through {period.end}, sorted by URL clicks,
            for Globe.com and Boston.com.
          </p>
        </div>
        <Button type="button" variant="primary" size="sm" disabled={disabled || busy} onClick={onSync}>
          {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> : <RefreshCw className="h-3.5 w-3.5" aria-hidden />}
          {busy ? 'Pulling Google data…' : 'Pull report dates'}
        </Button>
      </div>
      <div className="mt-3 flex flex-wrap gap-x-4 gap-y-2 text-xs">
        {Object.entries(SEARCH_DASHBOARDS).map(([id, dashboard]) => (
          <a
            key={id}
            href={dashboard.url}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1 font-medium text-sky-700 hover:underline dark:text-sky-400"
          >
            {dashboard.label}<ExternalLink className="h-3 w-3" aria-hidden />
          </a>
        ))}
      </div>
      {error ? (
        <p role="alert" className="mt-3 rounded-md border border-red-200 bg-white px-3 py-2 text-xs text-red-700 dark:border-red-900/60 dark:bg-zinc-950/50 dark:text-red-400">
          {error}
        </p>
      ) : null}
    </div>
  );
}
