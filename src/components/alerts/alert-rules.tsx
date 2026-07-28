'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { Bell, Loader2, Plus, Trash2 } from 'lucide-react';
import { METRIC_KEYS, PLATFORM_LABELS, PLATFORMS, type Platform } from '@/lib/types';
import { METRIC_DEFS } from '@/lib/metrics/definitions';
import { Card, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Field, Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { MultiSelect } from '@/components/ui/multi-select';
import { Toggle } from '@/components/ui/toggle';
import { Badge } from '@/components/ui/badge';
import { EmptyState } from '@/components/ui/empty-state';
import { formatRelative } from '@/components/ui/format';

export const ALERT_KINDS = [
  'competitor_outlier', 'audience_swing', 'volume_drop',
  'new_channel', 'keyword_hit', 'share_of_voice_shift', 'custom',
] as const;
export type AlertKind = (typeof ALERT_KINDS)[number];

export const KIND_COPY: Record<AlertKind, { label: string; description: string }> = {
  competitor_outlier: {
    label: 'Competitor outlier post',
    description: 'A rival post beats its own median engagement by a wide multiple. Usually the first sign of a story you have missed.',
  },
  audience_swing: {
    label: 'Audience swing',
    description: 'A following moves sharply in either direction. Sudden losses are as newsworthy as sudden gains, and often mean a platform purge.',
  },
  volume_drop: {
    label: 'Publishing drop',
    description: 'A company that had been posting regularly goes quiet. Frequently a strategy change, occasionally a broken feed on our side.',
  },
  new_channel: {
    label: 'New channel',
    description: 'A tracked company appears on a platform they were not on before.',
  },
  keyword_hit: {
    label: 'Keyword appears',
    description: 'Any tracked account posts about a term you are watching. The cheapest early warning available.',
  },
  share_of_voice_shift: {
    label: 'Share of voice shift',
    description: 'The split of who is publishing in the landscape moves past a threshold.',
  },
  custom: {
    label: 'Custom',
    description: 'A rule whose evaluation is defined in configuration rather than by a preset kind.',
  },
};

export interface AlertRuleRecord {
  id: string;
  name: string;
  kind: AlertKind;
  enabled: boolean;
  lastFiredAt: string | null;
  eventCount: number;
  config: {
    thresholdPct?: number;
    outlierMultiple?: number;
    keywords?: string[];
    platforms?: string[];
    metric?: string;
    lookbackDays?: number;
  };
  destinations: { type?: string }[];
}

export function AlertRules({ rules, landscapeId }: { rules: AlertRuleRecord[]; landscapeId: string }) {
  const router = useRouter();
  const [creating, setCreating] = React.useState(false);
  const [busyId, setBusyId] = React.useState<string | null>(null);
  const [error, setError] = React.useState<string | null>(null);

  const mutate = async (id: string, method: 'PATCH' | 'DELETE', body?: unknown) => {
    setBusyId(id);
    setError(null);
    try {
      const res = await fetch('/api/alerts/' + id, {
        method,
        headers: body ? { 'content-type': 'application/json' } : undefined,
        body: body ? JSON.stringify(body) : undefined,
      });
      if (!res.ok) throw new Error('Request failed with status ' + res.status + '.');
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not update the rule.');
    } finally {
      setBusyId(null);
    }
  };

  return (
    <Card>
      <CardHeader>
        <div>
          <CardTitle>Alert rules</CardTitle>
          <p className="mt-0.5 text-xs text-zinc-500 dark:text-zinc-400">
            Standing questions, evaluated on a schedule and delivered to Slack.
          </p>
        </div>
        <Button size="sm" variant="primary" onClick={() => setCreating((v) => !v)}>
          <Plus className="h-3 w-3" aria-hidden />
          New rule
        </Button>
      </CardHeader>

      {error ? (
        <p className="border-b border-red-200 bg-red-50 px-4 py-2 text-xs text-red-700 dark:border-red-900/50 dark:bg-red-950/30 dark:text-red-400">
          {error}
        </p>
      ) : null}

      {creating ? (
        <div className="border-b border-zinc-200 bg-zinc-50 p-4 dark:border-zinc-800 dark:bg-zinc-900/40">
          <AlertRuleForm
            landscapeId={landscapeId}
            onDone={() => {
              setCreating(false);
              router.refresh();
            }}
            onCancel={() => setCreating(false)}
          />
        </div>
      ) : null}

      {rules.length === 0 && !creating ? (
        <EmptyState
          compact
          icon={Bell}
          title="No alert rules"
          description="An alert is how you find out about a competitor's good day before someone forwards it to you. Start with an outlier rule on the landscape."
        />
      ) : (
        <ul className="divide-y divide-zinc-100 dark:divide-zinc-800/60">
          {rules.map((rule) => (
            <li key={rule.id} className="flex items-start gap-3 px-4 py-3">
              <div className="pt-0.5">
                <Toggle
                  hideLabel
                  label={'Enable ' + rule.name}
                  checked={rule.enabled}
                  disabled={busyId === rule.id}
                  onChange={(next) => mutate(rule.id, 'PATCH', { enabled: next })}
                />
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-xs font-medium text-zinc-900 dark:text-zinc-100">{rule.name}</span>
                  <Badge tone={rule.enabled ? 'neutral' : 'outline'}>{KIND_COPY[rule.kind].label}</Badge>
                  {rule.destinations.some((d) => d.type === 'slack') ? (
                    <Badge tone="outline">Slack</Badge>
                  ) : null}
                </div>
                <p className="mt-0.5 text-[11px] leading-relaxed text-zinc-500">
                  {KIND_COPY[rule.kind].description}
                </p>
                <p className="pb-num mt-1 text-[11px] text-zinc-400">
                  {rule.eventCount +
                    (rule.eventCount === 1 ? ' event' : ' events') +
                    ' · last fired ' +
                    formatRelative(rule.lastFiredAt)}
                </p>
              </div>
              <Button
                size="icon"
                variant="ghost"
                aria-label={'Delete ' + rule.name}
                disabled={busyId === rule.id}
                onClick={() => mutate(rule.id, 'DELETE')}
              >
                {busyId === rule.id ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
                ) : (
                  <Trash2 className="h-3.5 w-3.5" aria-hidden />
                )}
              </Button>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

function AlertRuleForm({
  landscapeId,
  onDone,
  onCancel,
}: {
  landscapeId: string;
  onDone: () => void;
  onCancel: () => void;
}) {
  const [name, setName] = React.useState('');
  const [kind, setKind] = React.useState<AlertKind>('competitor_outlier');
  const [thresholdPct, setThresholdPct] = React.useState('20');
  const [outlierMultiple, setOutlierMultiple] = React.useState('4');
  const [keywords, setKeywords] = React.useState('');
  const [platforms, setPlatforms] = React.useState<string[]>([]);
  const [metric, setMetric] = React.useState('engagementTotal');
  const [webhook, setWebhook] = React.useState('');
  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      const res = await fetch('/api/alerts', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          name: name.trim() || KIND_COPY[kind].label,
          kind,
          landscapeId,
          enabled: true,
          config: {
            thresholdPct: Math.max(0, Number(thresholdPct) || 0) / 100,
            outlierMultiple: Number(outlierMultiple) || 4,
            keywords: keywords.split(',').map((k) => k.trim()).filter(Boolean),
            platforms,
            metric,
          },
          destinations: webhook.trim() ? [{ type: 'slack', webhookUrl: webhook.trim() }] : [],
        }),
      });
      if (!res.ok) {
        const detail = await res.text();
        throw new Error(detail.slice(0, 300) || 'Create failed with status ' + res.status + '.');
      }
      onDone();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not create the rule.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <form onSubmit={submit} className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Rule name" htmlFor="alert-name">
          <Input
            id="alert-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Rival outlier on the mayoral race"
          />
        </Field>
        <Field label="What it watches" hint={KIND_COPY[kind].description}>
          <Select
            value={kind}
            onChange={(e) => setKind(e.target.value as AlertKind)}
            options={ALERT_KINDS.map((k) => ({ value: k, label: KIND_COPY[k].label }))}
          />
        </Field>
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        {kind === 'competitor_outlier' ? (
          <Field label="Outlier multiple" hint="Times the account’s own median engagement.">
            <Input
              type="number"
              min={1.5}
              step={0.5}
              value={outlierMultiple}
              onChange={(e) => setOutlierMultiple(e.target.value)}
            />
          </Field>
        ) : (
          <Field label="Threshold" hint="Percent movement that counts as news.">
            <Input
              type="number"
              min={0}
              max={100}
              value={thresholdPct}
              onChange={(e) => setThresholdPct(e.target.value)}
            />
          </Field>
        )}
        <Field label="Metric" hint="Where the kind allows a choice.">
          <Select
            value={metric}
            onChange={(e) => setMetric(e.target.value)}
            options={METRIC_KEYS.map((m) => ({ value: m, label: METRIC_DEFS[m].label }))}
          />
        </Field>
        <Field label="Platforms" hint="Leave empty to watch every channel.">
          <MultiSelect
            label="Platforms"
            options={PLATFORMS.map((p: Platform) => ({ value: p, label: PLATFORM_LABELS[p] }))}
            value={platforms}
            onChange={setPlatforms}
          />
        </Field>
      </div>

      {kind === 'keyword_hit' ? (
        <Field label="Keywords" hint="Comma separated. Any match fires the rule.">
          <Input value={keywords} onChange={(e) => setKeywords(e.target.value)} placeholder="layoffs, endorsement, recount" />
        </Field>
      ) : null}

      <Field
        label="Slack webhook"
        hint="Optional. Without a destination the rule still records events in the feed below."
      >
        <Input
          type="url"
          value={webhook}
          onChange={(e) => setWebhook(e.target.value)}
          placeholder="https://hooks.slack.com/services/..."
        />
      </Field>

      {error ? <p className="text-[11px] text-red-600 dark:text-red-400">{error}</p> : null}

      <div className="flex items-center gap-2">
        <Button type="submit" variant="primary" size="sm" disabled={saving}>
          {saving ? <Loader2 className="h-3 w-3 animate-spin" aria-hidden /> : null}
          Create rule
        </Button>
        <Button type="button" size="sm" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </form>
  );
}
