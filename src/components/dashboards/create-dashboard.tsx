'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { Loader2, Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Field, Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { Card, CardBody } from '@/components/ui/card';

/** Seeds a new dashboard with the three widgets that answer the standing question. */
const STARTER_WIDGETS = [
  { id: 'stat-audience', type: 'stat', metric: 'audience', span: 4 },
  { id: 'stat-engagement', type: 'stat', metric: 'engagementTotal', span: 4 },
  { id: 'stat-rate', type: 'stat', metric: 'engagementRateByFollower', span: 4 },
  { id: 'lb-rate', type: 'leaderboard', metric: 'engagementRateByFollower', span: 6 },
  { id: 'mix', type: 'platformMix', span: 6 },
];

export function CreateDashboard({
  landscapes,
  defaultLandscapeId,
}: {
  landscapes: { id: string; name: string }[];
  defaultLandscapeId: string | null;
}) {
  const router = useRouter();
  const [open, setOpen] = React.useState(false);
  const [name, setName] = React.useState('');
  const [landscapeId, setLandscapeId] = React.useState(defaultLandscapeId ?? landscapes[0]?.id ?? '');
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch('/api/dashboards', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          name: name.trim(),
          landscapeId: landscapeId || null,
          widgets: STARTER_WIDGETS,
        }),
      });
      if (!res.ok) {
        const detail = await res.text();
        throw new Error(detail.slice(0, 240) || 'Create failed with status ' + res.status + '.');
      }
      const created = (await res.json()) as { id?: string };
      if (created.id) router.push('/dashboards/' + created.id);
      else router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not create the dashboard.');
    } finally {
      setBusy(false);
    }
  };

  if (!open) {
    return (
      <Button variant="primary" size="sm" onClick={() => setOpen(true)}>
        <Plus className="h-3 w-3" aria-hidden />
        New dashboard
      </Button>
    );
  }

  return (
    <Card className="w-full sm:w-96">
      <CardBody>
        <form onSubmit={submit} className="space-y-3">
          <Field label="Dashboard name" htmlFor="dash-name">
            <Input
              id="dash-name"
              autoFocus
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Monday morning read"
              required
            />
          </Field>
          <Field label="Landscape" hint="Widgets read from this competitive set.">
            <Select
              value={landscapeId}
              onChange={(e) => setLandscapeId(e.target.value)}
              options={landscapes.map((l) => ({ value: l.id, label: l.name }))}
              placeholder={landscapes.length === 0 ? 'No landscapes yet' : undefined}
            />
          </Field>
          {error ? <p className="text-[11px] text-red-600 dark:text-red-400">{error}</p> : null}
          <div className="flex items-center gap-2">
            <Button type="submit" variant="primary" size="sm" disabled={busy}>
              {busy ? <Loader2 className="h-3 w-3 animate-spin" aria-hidden /> : null}
              Create
            </Button>
            <Button type="button" size="sm" onClick={() => setOpen(false)}>
              Cancel
            </Button>
          </div>
        </form>
      </CardBody>
    </Card>
  );
}
