'use client';

import * as React from 'react';
import { RefreshCw } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Select } from '@/components/ui/select';
import { cn } from '@/lib/utils';
import {
  BUG_AREA_LABELS, BUG_STATUSES, bugRef, type BugSeverity, type BugStatus,
} from '@/lib/bugs/parse';
import type { BugReport } from '@/lib/bugs/store';

const STATUS_LABELS: Record<BugStatus, string> = {
  new: 'New',
  triaged: 'Triaged',
  in_progress: 'In progress',
  fixed: 'Fixed',
  wont_fix: "Won't fix",
  duplicate: 'Duplicate',
};

const SEVERITY_TONE: Record<BugSeverity, 'critical' | 'warning' | 'neutral' | 'outline'> = {
  critical: 'critical',
  high: 'critical',
  medium: 'warning',
  low: 'outline',
};

const OPEN: BugStatus[] = ['new', 'triaged', 'in_progress'];

function when(isoText: string): string {
  return new Date(isoText).toLocaleString('en-US', {
    month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit',
  });
}

/**
 * Admin inbox: every report with its automatic triage and the facts behind
 * it. Status changes and re-triage happen in place.
 */
export function BugInbox({
  initial,
  initialSelectedId,
}: {
  initial: BugReport[];
  initialSelectedId: string | null;
}) {
  const [reports, setReports] = React.useState(initial);
  const [filter, setFilter] = React.useState<'open' | 'all'>('open');
  const [selectedId, setSelectedId] = React.useState<string | null>(
    initialSelectedId ?? initial.find((r) => OPEN.includes(r.status))?.id ?? initial[0]?.id ?? null,
  );

  const visible = reports.filter((r) => filter === 'all' || OPEN.includes(r.status));
  const selected = reports.find((r) => r.id === selectedId) ?? null;

  const replace = (next: BugReport) => setReports((all) => all.map((r) => (r.id === next.id ? next : r)));

  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,22rem)_minmax(0,1fr)]">
      <div className="min-w-0 rounded-lg border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900/40">
        <div className="flex items-center justify-between gap-2 border-b border-zinc-200 px-3 py-2 dark:border-zinc-800">
          <p className="text-[13px] font-semibold">Bug reports</p>
          <Select
            size="sm"
            aria-label="Show"
            value={filter}
            onChange={(e) => setFilter(e.target.value === 'all' ? 'all' : 'open')}
            options={[
              { value: 'open', label: 'Open (' + reports.filter((r) => OPEN.includes(r.status)).length + ')' },
              { value: 'all', label: 'All (' + reports.length + ')' },
            ]}
          />
        </div>
        {visible.length === 0 ? (
          <p className="px-3 py-6 text-center text-[13px] text-zinc-500">Nothing open. Reports from the sidebar land here.</p>
        ) : (
          <ul className="max-h-[70vh] divide-y divide-zinc-100 overflow-y-auto dark:divide-zinc-800">
            {visible.map((r) => (
              <li key={r.id}>
                <button
                  type="button"
                  onClick={() => setSelectedId(r.id)}
                  className={cn(
                    'w-full px-3 py-2.5 text-left transition-colors hover:bg-zinc-50 dark:hover:bg-zinc-900',
                    r.id === selectedId && 'bg-zinc-50 dark:bg-zinc-900',
                  )}
                >
                  <div className="flex items-center gap-1.5">
                    <span className="text-[11px] font-semibold text-zinc-500">{bugRef(r.number)}</span>
                    {r.severity ? <Badge tone={SEVERITY_TONE[r.severity]}>{r.severity}</Badge> : <Badge tone="outline">triaging</Badge>}
                    {r.area ? <Badge tone="neutral">{BUG_AREA_LABELS[r.area]}</Badge> : null}
                    <span className="ml-auto text-[11px] text-zinc-400">{when(r.createdAt)}</span>
                  </div>
                  <p className="mt-1 line-clamp-2 text-[13px] text-zinc-700 dark:text-zinc-300">
                    {r.triage?.summary ?? r.description}
                  </p>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      {selected ? <BugDetail key={selected.id} report={selected} onChange={replace} /> : null}
    </div>
  );
}

function BugDetail({ report, onChange }: { report: BugReport; onChange: (r: BugReport) => void }) {
  const [busy, setBusy] = React.useState<null | 'status' | 'retriage'>(null);
  const [error, setError] = React.useState<string | null>(null);

  async function patch(body: Record<string, unknown>, kind: 'status' | 'retriage') {
    setBusy(kind);
    setError(null);
    try {
      const res = await fetch('/api/bug-reports/' + report.id, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
      const json = await res.json().catch(() => null);
      if (!res.ok) throw new Error(json?.error ?? 'Update failed.');
      onChange(json as BugReport);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Update failed.');
    } finally {
      setBusy(null);
    }
  }

  const t = report.triage;
  return (
    <div className="min-w-0 space-y-4 rounded-lg border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900/40">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="text-sm font-semibold">{bugRef(report.number)}</h2>
        {report.severity ? <Badge tone={SEVERITY_TONE[report.severity]}>{report.severity}</Badge> : null}
        {report.area ? <Badge tone="neutral">{BUG_AREA_LABELS[report.area]}</Badge> : null}
        {report.duplicateOfNumber ? <Badge tone="outline">possible duplicate of {bugRef(report.duplicateOfNumber)}</Badge> : null}
        <div className="ml-auto flex items-center gap-2">
          <Select
            size="sm"
            aria-label="Status"
            value={report.status}
            disabled={busy !== null}
            onChange={(e) => patch({ status: e.target.value }, 'status')}
            options={BUG_STATUSES.map((s) => ({ value: s, label: STATUS_LABELS[s] }))}
          />
          <Button size="sm" disabled={busy !== null} onClick={() => patch({ retriage: true }, 'retriage')}>
            <RefreshCw className={cn('h-3 w-3', busy === 'retriage' && 'animate-spin')} aria-hidden />
            Re-check
          </Button>
        </div>
      </div>
      {error ? <p className="text-[12px] text-red-600">{error}</p> : null}

      <section>
        <p className="text-[11px] font-medium uppercase tracking-wide text-zinc-500">Reported</p>
        <p className="mt-1 whitespace-pre-wrap text-[13px] leading-relaxed">{report.description}</p>
        {report.expected ? (
          <p className="mt-2 whitespace-pre-wrap text-[13px] text-zinc-600 dark:text-zinc-400">
            <span className="font-medium">Expected:</span> {report.expected}
          </p>
        ) : null}
        <p className="mt-2 text-[11px] text-zinc-500">
          {report.reporterEmail ?? 'Unknown reporter'} · {when(report.createdAt)}
          {report.context.route ? ' · ' + report.context.route : ''}
          {report.pageUrl ? <> · <a className="underline" href={report.pageUrl} target="_blank" rel="noreferrer">open page</a></> : null}
        </p>
      </section>

      <section>
        <p className="text-[11px] font-medium uppercase tracking-wide text-zinc-500">
          Triage {t ? '(' + (t.method === 'model' ? 'model, verified against facts' : 'rules') + ')' : ''}
        </p>
        {t ? (
          <div className="mt-1 space-y-1.5 text-[13px] leading-relaxed">
            <p>{t.summary}</p>
            {t.likelyCause ? <p><span className="font-medium">Likely cause:</span> {t.likelyCause}</p> : null}
            {t.nextStep ? <p><span className="font-medium">Next step:</span> {t.nextStep}</p> : null}
            {t.fallbackReason ? <p className="text-[11px] text-zinc-500">Model triage skipped: {t.fallbackReason}</p> : null}
          </div>
        ) : (
          <p className="mt-1 text-[13px] text-zinc-500">Not triaged yet. It runs right after a report is sent; use Re-check if it stalled.</p>
        )}
      </section>

      {report.diagnostics?.posts.length ? (
        <section>
          <p className="text-[11px] font-medium uppercase tracking-wide text-zinc-500">Post checks</p>
          <ul className="mt-1 space-y-2">
            {report.diagnostics.posts.map((p) => (
              <li key={p.url} className="rounded-md border border-zinc-200 p-2.5 text-[13px] dark:border-zinc-800">
                <div className="flex flex-wrap items-center gap-1.5">
                  <Badge tone={p.verdict === 'stored' ? 'positive' : 'warning'}>{p.verdict.replace(/_/g, ' ')}</Badge>
                  <a href={p.url} target="_blank" rel="noreferrer" className="truncate text-[12px] underline">
                    {p.platformLabel}{p.handle ? ' @' + p.handle : ''} · {p.postKey}
                  </a>
                  {p.postedOn ? <span className="text-[11px] text-zinc-500">posted {p.postedOn}</span> : null}
                </div>
                <p className="mt-1 leading-relaxed text-zinc-700 dark:text-zinc-300">{p.verdictText}</p>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {report.diagnostics?.health ? (
        <p className="text-[11px] text-zinc-500">
          Collection health when checked: {report.diagnostics.health.overdueChannels} of {report.diagnostics.health.activeChannels} tracked
          profiles not collected in the last 24 hours.
        </p>
      ) : null}

      <details className="text-[12px] text-zinc-500">
        <summary className="cursor-pointer select-none">Captured context</summary>
        <pre className="mt-2 max-h-64 overflow-auto rounded bg-zinc-50 p-2 text-[11px] dark:bg-zinc-900">
          {JSON.stringify(report.context, null, 2)}
        </pre>
      </details>
    </div>
  );
}
