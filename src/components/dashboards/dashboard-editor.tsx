'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import {
  ArrowDown,
  ArrowUp,
  Check,
  Copy,
  Link2,
  Loader2,
  Pencil,
  Plus,
  Trash2,
} from 'lucide-react';
import { METRIC_KEYS, PLATFORM_LABELS, type MetricKey, type Platform } from '@/lib/types';
import { METRIC_DEFS } from '@/lib/metrics/definitions';
import { ADAPTER_SUPPORTED_PLATFORMS } from '@/lib/adapters/supported-platforms';
import { Card, CardBody, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Field, Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { Toggle } from '@/components/ui/toggle';
import { WIDGET_CATALOG, type WidgetDef, type WidgetType } from './widget-types';
import { absoluteShareUrl } from './share-url';

const SPANS: { value: string; label: string }[] = [
  { value: '4', label: 'One third' },
  { value: '6', label: 'One half' },
  { value: '8', label: 'Two thirds' },
  { value: '12', label: 'Full width' },
];

const METRIC_FREE = new Set<WidgetType>([
  'focusSummary',
  'platformMix',
  'topPosts',
  'cadence',
  'note',
]);
const PLATFORM_FREE = new Set<WidgetType>(['platformMix', 'note']);
const DASHBOARD_PLATFORMS: Platform[] = [...ADAPTER_SUPPORTED_PLATFORMS];

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
  const [items, setItems] = React.useState(widgets);
  const [open, setOpen] = React.useState(false);
  const [editingId, setEditingId] = React.useState<string | null>(null);
  const [type, setType] = React.useState<WidgetType>('leaderboard');
  const [metric, setMetric] = React.useState<MetricKey>('engagementRateByFollower');
  const [xMetric, setXMetric] = React.useState<MetricKey>('audience');
  const [platform, setPlatform] = React.useState<string>('');
  const [span, setSpan] = React.useState('6');
  const [title, setTitle] = React.useState('');
  const [text, setText] = React.useState('');
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [sharing, setSharing] = React.useState(false);
  const [shared, setShared] = React.useState(isShared);
  const [currentShareUrl, setCurrentShareUrl] = React.useState(shareUrl);
  const [copied, setCopied] = React.useState(false);

  const closeForm = () => {
    setOpen(false);
    setEditingId(null);
    setTitle('');
    setText('');
  };

  const beginCreate = () => {
    setEditingId(null);
    setType('leaderboard');
    setMetric('engagementRateByFollower');
    setXMetric('audience');
    setPlatform('');
    setSpan('6');
    setTitle('');
    setText('');
    setOpen(true);
  };

  const beginEdit = (widget: WidgetDef) => {
    setEditingId(widget.id);
    setType(widget.type);
    setMetric(widget.metric ?? 'engagementRateByFollower');
    setXMetric(widget.xMetric ?? 'audience');
    setPlatform(widget.platform ?? '');
    setSpan(String(widget.span ?? WIDGET_CATALOG.find((item) => item.type === widget.type)?.defaultSpan ?? 6));
    setTitle(widget.title ?? '');
    setText(widget.text ?? '');
    setOpen(true);
  };

  const save = async (next: WidgetDef[]): Promise<boolean> => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch('/api/dashboards/' + dashboardId, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ widgets: next }),
      });
      if (!res.ok) {
        const detail = await res.text();
        throw new Error(detail.slice(0, 240) || 'Save failed with status ' + res.status + '.');
      }
      setItems(next);
      router.refresh();
      return true;
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save the layout.');
      return false;
    } finally {
      setBusy(false);
    }
  };

  const submitWidget = async (e: React.FormEvent) => {
    e.preventDefault();
    const definition: WidgetDef = {
      id: editingId ?? type + '-' + Date.now().toString(36),
      type,
      span: Number(span) as 4 | 6 | 8 | 12,
      title: title.trim() || undefined,
      metric: METRIC_FREE.has(type) ? undefined : metric,
      xMetric: type === 'scatter' ? xMetric : undefined,
      platform: !PLATFORM_FREE.has(type) && platform ? (platform as Platform) : undefined,
      text: type === 'note' ? text : undefined,
    };
    const next = editingId
      ? items.map((widget) => (widget.id === editingId ? definition : widget))
      : [...items, definition];
    if (await save(next)) closeForm();
  };

  const moveWidget = async (index: number, direction: -1 | 1) => {
    const target = index + direction;
    if (target < 0 || target >= items.length) return;
    const next = [...items];
    [next[index], next[target]] = [next[target], next[index]];
    await save(next);
  };

  const removeWidget = async (id: string) => {
    if (await save(items.filter((widget) => widget.id !== id)) && editingId === id) {
      closeForm();
    }
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
      setShared(enabled);
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
            {items.length + (items.length === 1 ? ' widget' : ' widgets') +
              '. Edit or reorder any saved widget. All widgets inherit the landscape and window from the top bar.'}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button size="sm" variant="primary" onClick={beginCreate} disabled={busy}>
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
        <form onSubmit={submitWidget} className="space-y-3 border-b border-zinc-200 bg-zinc-50 p-4 dark:border-zinc-800 dark:bg-zinc-900/40">
          <p className="text-xs font-semibold text-zinc-800 dark:text-zinc-200">
            {editingId ? 'Edit widget' : 'Add widget'}
          </p>
          <div className="grid gap-3 sm:grid-cols-4">
            <Field
              label="Widget"
              hint={WIDGET_CATALOG.find((w) => w.type === type)?.description}
              className="sm:col-span-2"
            >
              <Select
                value={type}
                onChange={(e) => {
                  const nextType = e.target.value as WidgetType;
                  setType(nextType);
                  setSpan(String(WIDGET_CATALOG.find((widget) => widget.type === nextType)?.defaultSpan ?? 6));
                }}
                options={WIDGET_CATALOG.map((w) => ({ value: w.type, label: w.label }))}
              />
            </Field>
            <Field label="Width">
              <Select value={span} onChange={(e) => setSpan(e.target.value)} options={SPANS} />
            </Field>
            {PLATFORM_FREE.has(type) ? (
              <div />
            ) : (
              <Field label="Channel" hint="Optional. Scopes the widget to one platform.">
                <Select
                  value={platform}
                  onChange={(e) => setPlatform(e.target.value)}
                  options={[
                    { value: '', label: 'All channels' },
                    ...DASHBOARD_PLATFORMS.map((p) => ({ value: p, label: PLATFORM_LABELS[p] })),
                  ]}
                />
              </Field>
            )}
          </div>

          <div className="grid gap-3 sm:grid-cols-3">
            {type === 'scatter' ? (
              <Field label="X-axis metric" hint={METRIC_DEFS[xMetric].description.slice(0, 120) + '…'}>
                <Select
                  value={xMetric}
                  onChange={(e) => setXMetric(e.target.value as MetricKey)}
                  options={METRIC_KEYS.map((item) => ({ value: item, label: METRIC_DEFS[item].label }))}
                />
              </Field>
            ) : null}
            {METRIC_FREE.has(type) ? null : (
              <Field
                label={type === 'scatter' ? 'Y-axis metric' : 'Metric'}
                hint={METRIC_DEFS[metric].description.slice(0, 120) + '…'}
              >
                <Select
                  value={metric}
                  onChange={(e) => setMetric(e.target.value as MetricKey)}
                  options={METRIC_KEYS.map((m) => ({ value: m, label: METRIC_DEFS[m].label }))}
                />
              </Field>
            )}
            <Field
              label="Title"
              hint="Optional. Defaults to the widget or metric name."
              className={type === 'scatter' ? undefined : 'sm:col-span-2'}
            >
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
              {editingId ? 'Save changes' : 'Add to dashboard'}
            </Button>
            <Button type="button" size="sm" onClick={closeForm}>
              Cancel
            </Button>
          </div>
        </form>
      ) : null}

      {items.length > 0 ? (
        <ul className="divide-y divide-zinc-100 dark:divide-zinc-800/60">
          {items.map((w, index) => (
            <li
              key={w.id}
              className={
                'flex items-center gap-2 px-4 py-2 ' +
                (editingId === w.id ? 'bg-zinc-50 dark:bg-zinc-900/50' : '')
              }
            >
              <span className="min-w-0 flex-1 truncate text-xs text-zinc-700 dark:text-zinc-300">
                <span className="font-medium">
                  {w.title ?? WIDGET_CATALOG.find((c) => c.type === w.type)?.label ?? w.type}
                </span>
                <span className="text-zinc-400">
                  {' · ' +
                    (w.type === 'scatter'
                      ? (w.xMetric ? METRIC_DEFS[w.xMetric].shortLabel : METRIC_DEFS.audience.shortLabel) +
                        ' × ' +
                        (w.metric ? METRIC_DEFS[w.metric].shortLabel : METRIC_DEFS.engagementRateByFollower.shortLabel)
                      : w.metric
                        ? METRIC_DEFS[w.metric].shortLabel
                        : WIDGET_CATALOG.find((c) => c.type === w.type)?.label ?? '') +
                    (w.platform ? ' · ' + PLATFORM_LABELS[w.platform] : '')}
                </span>
              </span>
              <Button
                size="icon"
                variant="ghost"
                aria-label={'Edit ' + (w.title ?? w.type)}
                disabled={busy}
                onClick={() => beginEdit(w)}
              >
                <Pencil className="h-3.5 w-3.5" aria-hidden />
              </Button>
              <Button
                size="icon"
                variant="ghost"
                aria-label={'Move ' + (w.title ?? w.type) + ' up'}
                disabled={busy || index === 0}
                onClick={() => void moveWidget(index, -1)}
              >
                <ArrowUp className="h-3.5 w-3.5" aria-hidden />
              </Button>
              <Button
                size="icon"
                variant="ghost"
                aria-label={'Move ' + (w.title ?? w.type) + ' down'}
                disabled={busy || index === items.length - 1}
                onClick={() => void moveWidget(index, 1)}
              >
                <ArrowDown className="h-3.5 w-3.5" aria-hidden />
              </Button>
              <Button
                size="icon"
                variant="ghost"
                aria-label={'Remove ' + (w.title ?? w.type)}
                disabled={busy}
                onClick={() => void removeWidget(w.id)}
              >
                <Trash2 className="h-3.5 w-3.5" aria-hidden />
              </Button>
            </li>
          ))}
        </ul>
      ) : null}

      <CardBody className="border-t border-zinc-200 dark:border-zinc-800">
        <Toggle
          checked={shared}
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
                  await navigator.clipboard.writeText(
                    absoluteShareUrl(currentShareUrl, window.location.origin),
                  );
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
