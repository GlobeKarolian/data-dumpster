'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { Check, Copy, Link2, Loader2, Plus, Trash2 } from 'lucide-react';
import { METRIC_KEYS, PLATFORM_LABELS, type MetricKey, type Platform } from '@/lib/types';
import { METRIC_DEFS } from '@/lib/metrics/definitions';
import { NAV_PLATFORMS } from '@/components/shell/nav';
import { Card, CardBody, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Field, Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { Toggle } from '@/components/ui/toggle';
import { WIDGET_CATALOG, type WidgetDef, type WidgetType } from './widget-types';

const SPANS: { value: string; label: string }[] = [
  { value: '4', label: 'One third' },
  { value: '6', label: 'One half' },
  { value: '8', label: 'Two thirds' },
  { value: '12', label: 'Full width' },
];

const METRIC_FREE = new Set<WidgetType>(['platformMix', 'topPosts', 'cadence', 'note']);

/**
 * The dashboard editor.
 *
 * Deliberately a form rather than drag and drop. A newsroom dashboard is
 * assembled once and read fifty times; the cost of a good editing gesture is
 * not worth paying, and a form that states exactly what each widget will show
 * is easier to reason about than a canvas.
 */
export function DashboardEditor({
  dashboardId,
  widgets,
  isShared,
  shareUrl,
}: {
  dashboardId: string;
  widgets: WidgetDef[];
  isShared: boolean;
  shareUrl: string | null;
}) {
  const router = useRouter();
  const [open, setOpen] = React.useState(false);
  const [type, setType] = React.useState<WidgetType>('leaderboard');
  const [metric, setMetric] = React.useState<MetricKey>('engagementRateByFollower');
  const [platform, setPlatform] = React.useState<string>('');
  const [span, setSpan] = React.useState('6');
  const [title, setTitle] = React.useState('');
  const [text, setText] = React.useState('');
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [sharing, setSharing] = React.useState(false);
  const [currentShareUrl, setCurrentShareUrl] = React.useState(shareUrl);
  const [copied, setCopied] = React.useState(false);

  const save = async (next: WidgetDef[]) => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch('/api/dashboards/' + dashboardId, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ widgets: next }),
      });
      if (!res.ok) throw new Error('Save failed with status ' + res.status + '.');
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save the layout.');
    } finally {
      setBusy(false);
    }
  };

  const addWidget = async (e: React.FormEvent) => {
    e.preventDefault();
    const definition: WidgetDef = {
      id: type + '-' + Date.now().toString(36),
      type,
      span: Number(span) as 4 | 6 | 8 | 12,
      title: title.trim() || undefined,
      metric: METRIC_FREE.has(type) ? undefined : metric,
      platform: platform ? (platform as Platform) : undefined,
      text: type === 'note' ? text : undefined,
    };
    await save([...widgets, definition]);
    setOpen(false);
    setTitle('');
    setText('');
  };

  const toggleShare = async (enabled: boolean) => {
    setSharing(true);
    setError(null);
    try {
      const res = await fetch('/api/dashboards/' + dashboardId + '/share', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ enabled }),
      });
      if (!res.ok) throw new Error('Share toggle failed with status ' + res.status + '.');
      const body = (await res.json()) as { shareUrl: string | null };
      setCurrentShareUrl(body.shareUrl);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not change sharing.');
    } finally {
      setSharing(false);
    }
  };

  return (
    <Card className="mb-4">
      <CardHeader>
        <div>
          <CardTitle>Layout</CardTitle>
          <p className="mt-0.5 text-xs text-zinc-500 dark:text-zinc-400">
            {widgets.length + (widgets.length === 1 ? ' widget' : ' widgets') +
              '. Widgets inherit the landscape and window from the top bar.'}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button size="sm" variant="primary" onClick={() => setOpen((v) => !v)} disabled={busy}>
            <Plus className="h-3 w-3" aria-hidden />
            Add widget
          </Button>
        </div>
      </CardHeader>

      {error ? (
        <p className="border-b border-red-200 bg-red-50 px-4 py-2 text-xs text-red-700 dark:border-red-900/50 dark:bg-red-950/30 dark:text-red-400">
          {error}
        </p>
      ) : null}

      {open ? (
        <form onSubmit={addWidget} className="space-y-3 border-b border-zinc-200 bg-zinc-50 p-4 dark:border-zinc-800 dark:bg-zinc-900/40">
          <div className="grid gap-3 sm:grid-cols-4">
            <Field
              label="Widget"
              hint={WIDGET_CATALOG.find((w) => w.type === type)?.description}
              className="sm:col-span-2"
            >
              <Select
                value={type}
                onChange={(e) => setType(e.target.value as WidgetType)}
                options={WIDGET_CATALOG.map((w) => ({ value: w.type, label: w.label }))}
              />
            </Field>
            <Field label="Width">
              <Select value={span} onChange={(e) => setSpan(e.target.value)} options={SPANS} />
            </Field>
            <Field label="Channel" hint="Optional. Scopes the widget to one platform.">
              <Select
                value={platform}
                onChange={(e) => setPlatform(e.target.value)}
                options={[
                  { value: '', label: 'All channels' },
                  ...NAV_PLATFORMS.map((p) => ({ value: p, label: PLATFORM_LABELS[p] })),
                ]}
              />
            </Field>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            {METRIC_FREE.has(type) ? null : (
              <Field label="Metric" hint={METRIC_DEFS[metric].description.slice(0, 120) + '…'}>
                <Select
                  value={metric}
                  onChange={(e) => setMetric(e.target.value as MetricKey)}
                  options={METRIC_KEYS.map((m) => ({ value: m, label: METRIC_DEFS[m].label }))}
                />
              </Field>
            )}
            <Field label="Title" hint="Optional. Defaults to the metric name.">
              <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Where we stand on engagement rate" />
            </Field>
          </div>

          {type === 'note' ? (
            <Field label="Note text" hint="Context that belongs with the numbers, not in a separate doc.">
              <Input value={text} onChange={(e) => setText(e.target.value)} placeholder="Read the rate column first; totals are not comparable across these brands." />
            </Field>
          ) : null}

          <div className="flex items-center gap-2">
            <Button type="submit" variant="primary" size="sm" disabled={busy}>
              {busy ? <Loader2 className="h-3 w-3 animate-spin" aria-hidden /> : null}
              Add to dashboard
            </Button>
            <Button type="button" size="sm" onClick={() => setOpen(false)}>
              Cancel
            </Button>
          </div>
        </form>
      ) : null}

      {widgets.length > 0 ? (
        <ul className="divide-y divide-zinc-100 dark:divide-zinc-800/60">
          {widgets.map((w) => (
            <li key={w.id} className="flex items-center gap-3 px-4 py-2">
              <span className="min-w-0 flex-1 truncate text-xs text-zinc-700 dark:text-zinc-300">
                <span className="font-medium">
                  {w.title ?? WIDGET_CATALOG.find((c) => c.type === w.type)?.label ?? w.type}
                </span>
                <span className="text-zinc-400">
                  {' · ' +
                    (w.metric ? METRIC_DEFS[w.metric].shortLabel : WIDGET_CATALOG.find((c) => c.type === w.type)?.label ?? '') +
                    (w.platform ? ' · ' + PLATFORM_LABELS[w.platform] : '')}
                </span>
              </span>
              <Button
                size="icon"
                variant="ghost"
                aria-label={'Remove ' + (w.title ?? w.type)}
                disabled={busy}
                onClick={() => save(widgets.filter((x) => x.id !== w.id))}
              >
                <Trash2 className="h-3.5 w-3.5" aria-hidden />
              </Button>
            </li>
          ))}
        </ul>
      ) : null}

      <CardBody className="border-t border-zinc-200 dark:border-zinc-800">
        <Toggle
          checked={isShared}
          disabled={sharing}
          onChange={toggleShare}
          label="Share this dashboard publicly"
          description="Creates an unguessable read-only link. Anyone holding it can see these numbers without signing in, so treat it like the numbers themselves."
        />
        {currentShareUrl ? (
          <div className="mt-3 flex items-center gap-2 rounded-md border border-zinc-200 bg-zinc-50 px-2.5 py-2 dark:border-zinc-800 dark:bg-zinc-900">
            <Link2 className="h-3.5 w-3.5 shrink-0 text-zinc-400" aria-hidden />
            <code className="min-w-0 flex-1 truncate text-[11px] text-zinc-600 dark:text-zinc-400">
              {currentShareUrl}
            </code>
            <Button
              size="sm"
              onClick={async () => {
                try {
                  await navigator.clipboard.writeText(currentShareUrl);
                  setCopied(true);
                  window.setTimeout(() => setCopied(false), 1600);
                } catch {
                  setCopied(false);
                }
              }}
            >
              {copied ? <Check className="h-3 w-3" aria-hidden /> : <Copy className="h-3 w-3" aria-hidden />}
              {copied ? 'Copied' : 'Copy'}
            </Button>
          </div>
        ) : null}
      </CardBody>
    </Card>
  );
}
