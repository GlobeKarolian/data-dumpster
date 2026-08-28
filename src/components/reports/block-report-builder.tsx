'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import {
  ArrowDown,
  ArrowUp,
  Eye,
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
import {
  BLOCK_CATALOG,
  BLOCK_BENCHMARKS,
  type BlockBenchmark,
  type BlockDefinition,
  type BlockType,
} from '@/lib/blocks/definitions';
import { BlockPreview } from './block-preview';

const SPANS: { value: string; label: string }[] = [
  { value: '4', label: 'One third' },
  { value: '6', label: 'One half' },
  { value: '8', label: 'Two thirds' },
  { value: '12', label: 'Full width' },
];

const GRANULARITIES: { value: string; label: string }[] = [
  { value: '', label: 'Auto' },
  { value: 'day', label: 'Day' },
  { value: 'week', label: 'Week' },
  { value: 'month', label: 'Month' },
];

const BENCHMARK_LABELS: Record<BlockBenchmark, string> = {
  none: 'None',
  competitorAverage: 'Competitor average',
  competitorMedian: 'Competitor median',
  landscapeAverage: 'Landscape average',
  landscapeMedian: 'Landscape median',
  target: 'Target line',
};

/** Blocks that carry no metric selector. */
const METRIC_FREE = new Set<BlockType>([
  'focusSummary', 'platformMix', 'topPosts', 'cadence', 'note', 'narrative', 'storyCluster',
]);
/** Blocks that carry no platform selector. */
const PLATFORM_FREE = new Set<BlockType>(['platformMix', 'note', 'narrative']);
/** Blocks that carry prose rather than a computed series. */
const TEXTUAL = new Set<BlockType>(['note', 'narrative']);
/** Blocks a benchmark line can overlay. */
const BENCHMARKABLE = new Set<BlockType>(['timeseries', 'bar', 'stat']);

const PLATFORMS_LIST: Platform[] = [...ADAPTER_SUPPORTED_PLATFORMS];

/**
 * The block-based report builder.
 *
 * Same deliberate form-not-canvas model as the dashboard editor, extended to
 * blocks. The difference that matters is the live preview on the right: every
 * block renders from the real metrics layer as it is configured, which is the
 * one Rival IQ builder behaviour worth matching. A block never renders from a
 * placeholder, so what the editor shows is what the scheduled export will print.
 */
export function BlockReportBuilder({
  reportId,
  landscapeId,
  start,
  end,
  blocks,
}: {
  reportId: string;
  landscapeId: string;
  start: string;
  end: string;
  blocks: BlockDefinition[];
}) {
  const router = useRouter();
  const [items, setItems] = React.useState(blocks);
  const [open, setOpen] = React.useState(false);
  const [editingId, setEditingId] = React.useState<string | null>(null);
  const [previewId, setPreviewId] = React.useState<string | null>(null);
  const [type, setType] = React.useState<BlockType>('leaderboard');
  const [scope, setScope] = React.useState<'focus' | 'landscape'>('landscape');
  const [metric, setMetric] = React.useState<MetricKey>('engagementRateByFollower');
  const [xMetric, setXMetric] = React.useState<MetricKey>('audience');
  const [platform, setPlatform] = React.useState<string>('');
  const [granularity, setGranularity] = React.useState<string>('');
  const [benchmark, setBenchmark] = React.useState<BlockBenchmark>('none');
  const [benchmarkTarget, setBenchmarkTarget] = React.useState<string>('');
  const [span, setSpan] = React.useState('12');
  const [title, setTitle] = React.useState('');
  const [text, setText] = React.useState('');
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const catalogEntry = (t: BlockType) => BLOCK_CATALOG.find((c) => c.type === t);

  /** The scope a block actually measures, resolving `either` to the chosen value. */
  const effectiveScope = (t: BlockType, chosen: 'focus' | 'landscape'): 'focus' | 'landscape' => {
    const cat = catalogEntry(t)?.scope;
    if (cat === 'focus') return 'focus';
    if (cat === 'landscape') return 'landscape';
    return chosen;
  };

  const closeForm = () => {
    setOpen(false);
    setEditingId(null);
    setTitle('');
    setText('');
  };

  const beginCreate = () => {
    setEditingId(null);
    setType('leaderboard');
    setScope('landscape');
    setMetric('engagementRateByFollower');
    setXMetric('audience');
    setPlatform('');
    setGranularity('');
    setBenchmark('none');
    setBenchmarkTarget('');
    setSpan('12');
    setTitle('');
    setText('');
    setOpen(true);
  };

  const beginEdit = (block: BlockDefinition) => {
    setEditingId(block.id);
    setType(block.type);
    setScope(block.scope ?? 'landscape');
    setMetric(block.metric ?? 'engagementRateByFollower');
    setXMetric(block.xMetric ?? 'audience');
    setPlatform(block.platform ?? '');
    setGranularity(block.granularity ?? '');
    setBenchmark(block.benchmark ?? 'none');
    setBenchmarkTarget(block.benchmarkTarget !== undefined ? String(block.benchmarkTarget) : '');
    setSpan(String(block.span ?? catalogEntry(block.type)?.defaultSpan ?? 12));
    setTitle(block.title ?? '');
    setText(block.text ?? '');
    setOpen(true);
  };

  const save = async (next: BlockDefinition[]): Promise<boolean> => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch('/api/report-documents/' + reportId, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ blocks: next }),
      });
      if (!res.ok) {
        const detail = await res.text();
        throw new Error(detail.slice(0, 240) || 'Save failed with status ' + res.status + '.');
      }
      setItems(next);
      router.refresh();
      return true;
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save the report.');
      return false;
    } finally {
      setBusy(false);
    }
  };

  const currentDraft = (): BlockDefinition => ({
    id: editingId ?? 'draft',
    type,
    v: 1,
    span: Number(span) as 4 | 6 | 8 | 12,
    title: title.trim() || undefined,
    scope: effectiveScope(type, scope),
    metric: METRIC_FREE.has(type) ? undefined : metric,
    xMetric: type === 'scatter' ? xMetric : undefined,
    platform: !PLATFORM_FREE.has(type) && platform ? (platform as Platform) : undefined,
    granularity: granularity ? (granularity as BlockDefinition['granularity']) : undefined,
    benchmark: BENCHMARKABLE.has(type) ? benchmark : undefined,
    benchmarkTarget:
      BENCHMARKABLE.has(type) && benchmark === 'target' && benchmarkTarget.trim() !== ''
        ? Number(benchmarkTarget)
        : undefined,
    text: TEXTUAL.has(type) ? text : undefined,
  });

  const submitBlock = async (e: React.FormEvent) => {
    e.preventDefault();
    const definition = { ...currentDraft(), id: editingId ?? type + '-' + Date.now().toString(36) };
    const next = editingId
      ? items.map((b) => (b.id === editingId ? definition : b))
      : [...items, definition];
    if (await save(next)) closeForm();
  };

  const moveBlock = async (index: number, direction: -1 | 1) => {
    const target = index + direction;
    if (target < 0 || target >= items.length) return;
    const next = [...items];
    [next[index], next[target]] = [next[target], next[index]];
    await save(next);
  };

  const removeBlock = async (id: string) => {
    if (await save(items.filter((b) => b.id !== id))) {
      if (editingId === id) closeForm();
      if (previewId === id) setPreviewId(null);
    }
  };

  const previewBlock: BlockDefinition | null = open
    ? currentDraft()
    : (items.find((b) => b.id === previewId) ?? null);

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Card className="mb-4">
        <CardHeader>
          <div>
            <CardTitle>Blocks</CardTitle>
            <p className="mt-0.5 text-xs text-zinc-500 dark:text-zinc-400">
              {items.length + (items.length === 1 ? ' block' : ' blocks') +
                ', in report order. Edit, reorder, or remove any block. The preview on the right renders the block as it will print.'}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Button size="sm" variant="primary" onClick={beginCreate} disabled={busy}>
              <Plus className="h-3 w-3" aria-hidden />
              Add block
            </Button>
          </div>
        </CardHeader>

        {error ? (
          <p className="border-b border-red-200 bg-red-50 px-4 py-2 text-xs text-red-700 dark:border-red-900/50 dark:bg-red-950/30 dark:text-red-400">
            {error}
          </p>
        ) : null}

        {open ? (
          <form onSubmit={submitBlock} className="space-y-3 border-b border-zinc-200 bg-zinc-50 p-4 dark:border-zinc-800 dark:bg-zinc-900/40">
            <p className="text-xs font-semibold text-zinc-800 dark:text-zinc-200">
              {editingId ? 'Edit block' : 'Add block'}
            </p>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Block" hint={catalogEntry(type)?.description}>
                <Select
                  value={type}
                  onChange={(e) => {
                    const nextType = e.target.value as BlockType;
                    setType(nextType);
                    setSpan(String(catalogEntry(nextType)?.defaultSpan ?? 12));
                  }}
                  options={BLOCK_CATALOG.map((b) => ({ value: b.type, label: b.label }))}
                />
              </Field>
              <Field label="Width">
                <Select value={span} onChange={(e) => setSpan(e.target.value)} options={SPANS} />
              </Field>
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              {catalogEntry(type)?.scope === 'either' ? (
                <Field label="Scope" hint="Measure the focus company alone or the whole landscape.">
                  <Select
                    value={scope}
                    onChange={(e) => setScope(e.target.value as 'focus' | 'landscape')}
                    options={[
                      { value: 'landscape', label: 'Landscape' },
                      { value: 'focus', label: 'Focus company' },
                    ]}
                  />
                </Field>
              ) : (
                <div />
              )}
              {PLATFORM_FREE.has(type) ? (
                <div />
              ) : (
                <Field label="Channel" hint="Optional. Scopes the block to one platform.">
                  <Select
                    value={platform}
                    onChange={(e) => setPlatform(e.target.value)}
                    options={[
                      { value: '', label: 'All channels' },
                      ...PLATFORMS_LIST.map((p) => ({ value: p, label: PLATFORM_LABELS[p] })),
                    ]}
                  />
                </Field>
              )}
            </div>

            <div className="grid gap-3 sm:grid-cols-3">
              {type === 'scatter' ? (
                <Field label="X-axis metric" hint={METRIC_DEFS[xMetric].description.slice(0, 90) + '…'}>
                  <Select
                    value={xMetric}
                    onChange={(e) => setXMetric(e.target.value as MetricKey)}
                    options={METRIC_KEYS.map((m) => ({ value: m, label: METRIC_DEFS[m].label }))}
                  />
                </Field>
              ) : null}
              {METRIC_FREE.has(type) ? null : (
                <Field
                  label={type === 'scatter' ? 'Y-axis metric' : 'Metric'}
                  hint={METRIC_DEFS[metric].description.slice(0, 90) + '…'}
                >
                  <Select
                    value={metric}
                    onChange={(e) => setMetric(e.target.value as MetricKey)}
                    options={METRIC_KEYS.map((m) => ({ value: m, label: METRIC_DEFS[m].label }))}
                  />
                </Field>
              )}
              <Field label="Title" hint="Optional. Defaults to the block or metric name.">
                <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Where we stand on engagement rate" />
              </Field>
            </div>

            <div className="grid gap-3 sm:grid-cols-3">
              {type === 'timeseries' || type === 'cadence' ? (
                <Field label="Grouped by">
                  <Select value={granularity} onChange={(e) => setGranularity(e.target.value)} options={GRANULARITIES} />
                </Field>
              ) : null}
              {BENCHMARKABLE.has(type) ? (
                <Field label="Compare against" hint="A benchmark line overlaid on the block.">
                  <Select
                    value={benchmark}
                    onChange={(e) => setBenchmark(e.target.value as BlockBenchmark)}
                    options={BLOCK_BENCHMARKS.map((b) => ({ value: b, label: BENCHMARK_LABELS[b] }))}
                  />
                </Field>
              ) : null}
              {BENCHMARKABLE.has(type) && benchmark === 'target' ? (
                <Field label="Target value">
                  <Input value={benchmarkTarget} onChange={(e) => setBenchmarkTarget(e.target.value)} placeholder="0.05" />
                </Field>
              ) : null}
            </div>

            {TEXTUAL.has(type) ? (
              <Field label="Text" hint={type === 'narrative' ? 'Verified against a code-computed fact sheet before it renders.' : 'Context that belongs with the numbers.'}>
                <Input value={text} onChange={(e) => setText(e.target.value)} placeholder="Read the rate column first; totals are not comparable across these brands." />
              </Field>
            ) : null}

            <div className="flex items-center gap-2">
              <Button type="submit" variant="primary" size="sm" disabled={busy}>
                {busy ? <Loader2 className="h-3 w-3 animate-spin" aria-hidden /> : null}
                {editingId ? 'Save changes' : 'Add to report'}
              </Button>
              <Button type="button" size="sm" onClick={closeForm}>
                Cancel
              </Button>
            </div>
          </form>
        ) : null}

        {items.length > 0 ? (
          <ul className="divide-y divide-zinc-100 dark:divide-zinc-800/60">
            {items.map((b, index) => (
              <li
                key={b.id}
                className={
                  'flex items-center gap-2 px-4 py-2 ' +
                  (editingId === b.id || previewId === b.id ? 'bg-zinc-50 dark:bg-zinc-900/50' : '')
                }
              >
                <span className="min-w-0 flex-1 truncate text-xs text-zinc-700 dark:text-zinc-300">
                  <span className="font-medium">
                    {b.title ?? catalogEntry(b.type)?.label ?? b.type}
                  </span>
                  <span className="text-zinc-400">
                    {' · ' +
                      (b.type === 'scatter'
                        ? (b.xMetric ? METRIC_DEFS[b.xMetric].shortLabel : METRIC_DEFS.audience.shortLabel) +
                          ' × ' +
                          (b.metric ? METRIC_DEFS[b.metric].shortLabel : METRIC_DEFS.engagementRateByFollower.shortLabel)
                        : b.metric
                          ? METRIC_DEFS[b.metric].shortLabel
                          : catalogEntry(b.type)?.label ?? '') +
                      (b.platform ? ' · ' + PLATFORM_LABELS[b.platform] : '')}
                  </span>
                </span>
                <Button
                  size="icon"
                  variant="ghost"
                  aria-label={'Preview ' + (b.title ?? b.type)}
                  disabled={busy}
                  onClick={() => setPreviewId(previewId === b.id ? null : b.id)}
                >
                  <Eye className="h-3.5 w-3.5" aria-hidden />
                </Button>
                <Button
                  size="icon"
                  variant="ghost"
                  aria-label={'Edit ' + (b.title ?? b.type)}
                  disabled={busy}
                  onClick={() => beginEdit(b)}
                >
                  <Pencil className="h-3.5 w-3.5" aria-hidden />
                </Button>
                <Button
                  size="icon"
                  variant="ghost"
                  aria-label={'Move ' + (b.title ?? b.type) + ' up'}
                  disabled={busy || index === 0}
                  onClick={() => void moveBlock(index, -1)}
                >
                  <ArrowUp className="h-3.5 w-3.5" aria-hidden />
                </Button>
                <Button
                  size="icon"
                  variant="ghost"
                  aria-label={'Move ' + (b.title ?? b.type) + ' down'}
                  disabled={busy || index === items.length - 1}
                  onClick={() => void moveBlock(index, 1)}
                >
                  <ArrowDown className="h-3.5 w-3.5" aria-hidden />
                </Button>
                <Button
                  size="icon"
                  variant="ghost"
                  aria-label={'Remove ' + (b.title ?? b.type)}
                  disabled={busy}
                  onClick={() => void removeBlock(b.id)}
                >
                  <Trash2 className="h-3.5 w-3.5" aria-hidden />
                </Button>
              </li>
            ))}
          </ul>
        ) : null}

        <CardBody className="border-t border-zinc-200 text-xs text-zinc-500 dark:border-zinc-800 dark:text-zinc-400">
          Blocks read only through the metrics layer, so audience-as-stock, null-on-zero-baseline,
          and availability travel into the report exactly as they do on a dashboard. A block can
          never print a number the live view would not.
        </CardBody>
      </Card>

      <div className="lg:sticky lg:top-20 lg:self-start">
        {previewBlock ? (
          <BlockPreview
            block={previewBlock}
            landscapeId={landscapeId}
            start={start}
            end={end}
          />
        ) : (
          <Card>
            <CardBody className="py-12 text-center text-xs text-zinc-400">
              Add a block, or press the preview icon on a saved block, to see it rendered against
              the real metrics layer here.
            </CardBody>
          </Card>
        )}
      </div>
    </div>
  );
}
