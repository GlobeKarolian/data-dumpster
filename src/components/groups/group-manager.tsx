'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { Loader2, Plus, Trash2, ExternalLink } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Field, Input } from '@/components/ui/input';

export interface GroupRecord {
  id: string;
  name: string;
  area: string | null;
  url: string;
  active: boolean;
  /** Posts inside the window selected in the top bar, not a fixed 30 days. */
  postsInWindow: number;
  lastCollectedAt: string | null;
  outcome: string | null;
}

const OUTCOME_STYLE: Record<string, { label: string; className: string }> = {
  covered: { label: 'Collecting', className: 'text-emerald-700 dark:text-emerald-400' },
  collecting: { label: 'In progress', className: 'text-blue-700 dark:text-blue-400' },
  ineligible: { label: 'Source refused, not collectible', className: 'text-amber-700 dark:text-amber-400' },
  failed: { label: 'Retrying', className: 'text-zinc-500' },
  // Without this entry a paused group fell through to "Queued", which reads as
  // "any minute now" for something that is deliberately not running.
  paused: { label: 'Paused', className: 'text-amber-700 dark:text-amber-400' },
};

export function GroupManager({ groups, canManage }: { groups: GroupRecord[]; canManage: boolean }) {
  const router = useRouter();
  const [open, setOpen] = React.useState(false);
  const [url, setUrl] = React.useState('');
  const [name, setName] = React.useState('');
  const [area, setArea] = React.useState('');
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const add = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch('/api/groups', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ url, name, area: area || undefined }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? 'Could not add that group.');
      }
      setUrl(''); setName(''); setArea(''); setOpen(false);
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not add that group.');
    } finally {
      setBusy(false);
    }
  };

  const remove = async (id: string) => {
    const res = await fetch('/api/groups', {
      method: 'DELETE',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ id }),
    });
    if (res.ok) router.refresh();
  };

  return (
    <div>
      {canManage ? (
        <div className="border-b border-zinc-100 px-4 py-3 dark:border-zinc-800/60">
          {open ? (
            <div className="space-y-3">
              <Field label="Public Facebook group URL" htmlFor="group-url">
                <Input id="group-url" placeholder="https://www.facebook.com/groups/…"
                  value={url} onChange={(e) => setUrl(e.target.value)} />
              </Field>
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="Name" htmlFor="group-name">
                  <Input id="group-name" placeholder="Somerville Neighborhood News"
                    value={name} onChange={(e) => setName(e.target.value)} />
                </Field>
                <Field label="Area (optional)" htmlFor="group-area">
                  <Input id="group-area" placeholder="Somerville"
                    value={area} onChange={(e) => setArea(e.target.value)} />
                </Field>
              </div>
              {error ? (
                <p className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700 dark:border-red-900/50 dark:bg-red-950/30 dark:text-red-400">
                  {error}
                </p>
              ) : null}
              <div className="flex items-center gap-2">
                <Button size="sm" onClick={add} disabled={busy || !url || !name}>
                  {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : 'Add group'}
                </Button>
                <Button size="sm" variant="ghost" onClick={() => { setOpen(false); setError(null); }}>
                  Cancel
                </Button>
              </div>
            </div>
          ) : (
            <Button size="sm" variant="secondary" onClick={() => setOpen(true)}>
              <Plus className="h-3.5 w-3.5" /> Add group
            </Button>
          )}
        </div>
      ) : null}

      {groups.length === 0 ? (
        <p className="px-4 py-6 text-center text-sm text-zinc-500">No groups watched yet.</p>
      ) : (
        <ul className="divide-y divide-zinc-100 dark:divide-zinc-800/60">
          {groups.map((g) => {
            const style = g.outcome ? OUTCOME_STYLE[g.outcome] : null;
            return (
              <li key={g.id} className="flex items-center gap-3 px-4 py-3">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-sm font-medium text-zinc-900 dark:text-zinc-100">{g.name}</span>
                    {g.area ? <span className="text-xs text-zinc-400">{g.area}</span> : null}
                    <a href={g.url} target="_blank" rel="noreferrer noopener"
                      className="text-zinc-400 hover:text-zinc-600" title="Open the group">
                      <ExternalLink className="h-3.5 w-3.5" aria-hidden />
                    </a>
                  </div>
                  <p className={'mt-0.5 text-[11px] ' + (style?.className ?? 'text-zinc-400')}>
                    {style?.label ?? 'Queued'}
                    {g.lastCollectedAt ? ' · last read ' + new Date(g.lastCollectedAt).toLocaleDateString() : ''}
                  </p>
                </div>
                <span className="pb-num shrink-0 text-right text-sm tabular-nums text-zinc-500">
                  {g.postsInWindow.toLocaleString()}
                  <span className="ml-1 text-[10px] uppercase tracking-wide text-zinc-400">posts</span>
                </span>
                {canManage ? (
                  <Button size="icon" variant="ghost" aria-label={'Remove ' + g.name}
                    onClick={() => remove(g.id)}>
                    <Trash2 className="h-3.5 w-3.5" aria-hidden />
                  </Button>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
