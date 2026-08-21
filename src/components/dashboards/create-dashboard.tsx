'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { BarChart3, FileText, Loader2, Plus, Swords, Tv } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { PLATFORM_LABELS, type Platform } from '@/lib/types';
import { ADAPTER_SUPPORTED_PLATFORMS } from '@/lib/adapters/supported-platforms';
import { Button } from '@/components/ui/button';
import { Field, Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { Card, CardBody } from '@/components/ui/card';

/**
 * Templates speak the manager's language, not the widget vocabulary.
 *
 * A beginner should get a useful dashboard by answering two questions they
 * already understand — what is this for, and which competitive set — without
 * ever meeting the word "widget". Each template is just a starting layout;
 * everything is editable afterwards, which is what makes it safe for the
 * template names to be opinionated.
 */
interface Template {
  key: string;
  label: string;
  description: string;
  icon: LucideIcon;
  /** Whether this template needs a platform choice before it makes sense. */
  needsPlatform?: boolean;
  widgets: (platform?: Platform) => Record<string, unknown>[];
}

const TEMPLATES: Template[] = [
  {
    key: 'exec',
    label: 'Monday morning read',
    description: 'The headline numbers, who leads on engagement rate, and the best posts. The one you open before standup.',
    icon: FileText,
    widgets: () => [
      { id: 'focus', type: 'focusSummary', span: 12 },
      { id: 'lb-rate', type: 'leaderboard', metric: 'engagementRateByFollower', span: 6 },
      { id: 'mix', type: 'platformMix', span: 6 },
      { id: 'tags', type: 'tagTop', span: 6 },
      { id: 'cadence', type: 'cadence', span: 6 },
      { id: 'top', type: 'topPosts', span: 12 },
    ],
  },
  {
    key: 'platform',
    label: 'Platform deep-dive',
    description: 'One channel, end to end: volume, engagement, trend, posting rhythm and the top posts on it.',
    icon: Tv,
    needsPlatform: true,
    widgets: (platform) => [
      { id: 'stat-posts', type: 'stat', metric: 'posts', span: 4, platform },
      { id: 'stat-eng', type: 'stat', metric: 'engagementTotal', span: 4, platform },
      { id: 'stat-aud', type: 'stat', metric: 'audience', span: 4, platform },
      { id: 'trend', type: 'timeseries', metric: 'engagementTotal', span: 8, platform },
      { id: 'cadence', type: 'cadence', span: 4, platform },
      { id: 'top', type: 'topPosts', span: 12, platform },
    ],
  },
  {
    key: 'competitive',
    label: 'Competitor watch',
    description: 'Everyone ranked, scale against efficiency, and the full table. For knowing where you actually stand.',
    icon: Swords,
    widgets: () => [
      { id: 'lb-posts', type: 'leaderboard', metric: 'posts', span: 6 },
      { id: 'lb-rate', type: 'leaderboard', metric: 'engagementRateByFollower', span: 6 },
      { id: 'scatter', type: 'scatter', xMetric: 'audience', metric: 'engagementRateByFollower', span: 8 },
      { id: 'mix', type: 'platformMix', span: 4 },
      { id: 'table', type: 'table', metric: 'engagementTotal', span: 12 },
    ],
  },
  {
    key: 'blank',
    label: 'Blank canvas',
    description: 'Start from nothing and add exactly the widgets you want. For people who already know the vocabulary.',
    icon: BarChart3,
    widgets: () => [],
  },
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
  const [template, setTemplate] = React.useState<Template>(TEMPLATES[0]);
  const [name, setName] = React.useState('');
  const [landscapeId, setLandscapeId] = React.useState(defaultLandscapeId ?? landscapes[0]?.id ?? '');
  const [platform, setPlatform] = React.useState<Platform>('instagram');
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
          widgets: template.widgets(template.needsPlatform ? platform : undefined),
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
    <Card className="w-full lg:max-w-2xl">
      <CardBody>
        <form onSubmit={submit} className="space-y-4">
          <div>
            <p className="text-xs font-semibold text-zinc-800 dark:text-zinc-200">
              What is this dashboard for?
            </p>
            <div className="mt-2 grid gap-2 sm:grid-cols-2">
              {TEMPLATES.map((item) => {
                const Icon = item.icon;
                const selected = template.key === item.key;
                return (
                  <button
                    key={item.key}
                    type="button"
                    onClick={() => setTemplate(item)}
                    aria-pressed={selected}
                    className={
                      'rounded-lg border p-3 text-left transition-colors '
                      + (selected
                        ? 'border-accent-600 bg-accent-50/60 dark:border-accent-500 dark:bg-accent-950/20'
                        : 'border-zinc-200 hover:border-zinc-300 dark:border-zinc-800 dark:hover:border-zinc-700')
                    }
                  >
                    <span className="flex items-center gap-2">
                      <Icon className={'h-3.5 w-3.5 ' + (selected ? 'text-accent-700 dark:text-accent-400' : 'text-zinc-400')} aria-hidden />
                      <span className="text-sm font-medium text-zinc-900 dark:text-zinc-100">{item.label}</span>
                    </span>
                    <span className="mt-1 block text-[11px] leading-relaxed text-zinc-500 dark:text-zinc-400">
                      {item.description}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Dashboard name" htmlFor="dash-name">
              <Input
                id="dash-name"
                autoFocus
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder={template.key === 'platform' ? 'Instagram, weekly' : 'Monday morning read'}
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
            {template.needsPlatform ? (
              <Field label="Channel" hint="The platform this dashboard dives into.">
                <Select
                  value={platform}
                  onChange={(e) => setPlatform(e.target.value as Platform)}
                  options={ADAPTER_SUPPORTED_PLATFORMS.map((p) => ({ value: p, label: PLATFORM_LABELS[p] }))}
                />
              </Field>
            ) : null}
          </div>

          {error ? <p className="text-[11px] text-red-600 dark:text-red-400">{error}</p> : null}
          <div className="flex items-center gap-2">
            <Button type="submit" variant="primary" size="sm" disabled={busy}>
              {busy ? <Loader2 className="h-3 w-3 animate-spin" aria-hidden /> : null}
              Create dashboard
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
