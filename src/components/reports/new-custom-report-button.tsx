'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { Loader2, LayoutTemplate } from 'lucide-react';
import { Button } from '@/components/ui/button';

/**
 * Start a block-based custom report.
 *
 * Creates an empty report document and drops the editor straight into the
 * builder, where blocks are assembled against a live preview. Unlike the
 * weekly report (a dated, computed snapshot), a custom report is an ordered
 * block layout that renders fresh each time it is opened or delivered.
 */
export function NewCustomReportButton({ landscapeId }: { landscapeId: string }) {
  const router = useRouter();
  const [name, setName] = React.useState('');
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const create = async () => {
    const trimmed = name.trim() || 'Untitled report';
    setBusy(true);
    setError(null);
    try {
      const res = await fetch('/api/report-documents', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: trimmed, landscapeId, blocks: [] }),
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
      if (id) router.push('/reports/builder/' + id + '?landscape=' + encodeURIComponent(landscapeId));
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
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              void create();
            }
          }}
          placeholder="Competitive monthly"
          aria-label="Custom report name"
          className="h-7 w-44 rounded-md border border-zinc-200 bg-white px-2 text-xs text-zinc-800 transition-colors focus:border-accent-600 focus:outline-none dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-200"
        />
        <Button variant="primary" size="sm" onClick={create} disabled={busy}>
          {busy
            ? <Loader2 className="h-3 w-3 animate-spin" aria-hidden />
            : <LayoutTemplate className="h-3 w-3" aria-hidden />}
          {busy ? 'Creating' : 'Build a custom report'}
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
