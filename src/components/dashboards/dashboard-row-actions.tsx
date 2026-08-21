'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { Copy, Loader2, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';

/**
 * Duplicate and delete, from the list.
 *
 * Both actions existed in the API since the first release; the UI simply never
 * exposed them, which is how an org ends up carrying dashboards named "test"
 * forever. Duplicate reads the source layout and posts it back under a new
 * name, so a good dashboard becomes a starting point instead of a one-off.
 */
export function DashboardRowActions({
  dashboardId,
  name,
  landscapeId,
}: {
  dashboardId: string;
  name: string;
  landscapeId: string | null;
}) {
  const router = useRouter();
  const [busy, setBusy] = React.useState(false);
  const [confirming, setConfirming] = React.useState(false);

  const duplicate = async (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setBusy(true);
    try {
      const source = await fetch('/api/dashboards/' + dashboardId);
      if (!source.ok) throw new Error('Could not read the dashboard.');
      const body = (await source.json()) as { widgets?: unknown };
      const res = await fetch('/api/dashboards', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          name: name + ' copy',
          landscapeId,
          widgets: Array.isArray(body.widgets) ? body.widgets : [],
        }),
      });
      if (!res.ok) throw new Error('Could not duplicate the dashboard.');
      const created = (await res.json()) as { id?: string };
      if (created.id) router.push('/dashboards/' + created.id);
      else router.refresh();
    } catch {
      router.refresh();
    } finally {
      setBusy(false);
    }
  };

  const destroy = async (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (!confirming) {
      setConfirming(true);
      window.setTimeout(() => setConfirming(false), 2600);
      return;
    }
    setBusy(true);
    try {
      await fetch('/api/dashboards/' + dashboardId, { method: 'DELETE' });
      router.refresh();
    } finally {
      setBusy(false);
      setConfirming(false);
    }
  };

  return (
    <span className="flex shrink-0 items-center gap-1" onClick={(e) => e.preventDefault()}>
      {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin text-zinc-400" aria-hidden /> : null}
      <Button
        size="icon"
        variant="ghost"
        aria-label={'Duplicate ' + name}
        title="Duplicate"
        disabled={busy}
        onClick={duplicate}
      >
        <Copy className="h-3.5 w-3.5" aria-hidden />
      </Button>
      <Button
        size={confirming ? 'sm' : 'icon'}
        variant={confirming ? 'danger' : 'ghost'}
        aria-label={'Delete ' + name}
        title={confirming ? 'Click again to confirm' : 'Delete'}
        disabled={busy}
        onClick={destroy}
      >
        {confirming ? 'Really delete?' : <Trash2 className="h-3.5 w-3.5" aria-hidden />}
      </Button>
    </span>
  );
}
