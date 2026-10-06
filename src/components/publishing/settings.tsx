'use client';

import * as React from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { Card, CardBody, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Field, Input, Textarea } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { Toggle } from '@/components/ui/toggle';
import { PlatformIcon } from '@/components/ui/platform-icon';
import {
  PUBLISH_PLATFORMS, PUBLISH_PLATFORM_LABELS, linkModeFor, type PublishPlatform, type PublishProvider,
} from '@/lib/publishing/platforms';
import { DEFAULT_UTM } from '@/lib/publishing/utm';
import { api, fmtTime, fmtWhen, minuteLabel, WEEKDAYS, type Rule, type Target } from './api';
import { usePublish } from './shell';
import { accountName } from './bits';

interface Channel { id: string; platform: string; handle: string; company: string }
interface Feed {
  id: string; label: string; url: string; target_ids: string[]; templates: Record<string, string>;
  window_minutes: number; require_approval: boolean; active: boolean; last_polled_at: string | null; last_error: string | null;
  include_categories?: string[]; exclude_keywords?: string[];
  recent?: { title: string | null; link: string | null; outcome: string | null; seen_at: string }[];
}

const PROVIDER_LABEL: Record<PublishProvider, string> = { ayrshare: 'Ayrshare', bluesky: 'Bluesky direct', mock: 'Test only' };

/* ------------------------------------------------------------ day-parting */

const toTime = (m: number) => `${String(Math.floor(m / 60) % 24).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
const fromTime = (s: string, end = false) => {
  const [h, m] = s.split(':').map(Number);
  const v = h * 60 + m;
  return end && v === 0 ? 1440 : v;
};

/** Templates for the common newsroom shapes; editors adjust from there. */
const RULE_PRESETS: { id: string; label: string; build: () => Rule[] }[] = [
  { id: 'news', label: 'News day (6am to 11pm daily)', build: () => [0, 1, 2, 3, 4, 5, 6].map((d) => ({ weekday: d, startMinute: 360, endMinute: 1380 })) },
  { id: 'split', label: 'Mornings and evenings on weekdays, all day weekends', build: () => [
    ...[1, 2, 3, 4, 5].flatMap((d) => [{ weekday: d, startMinute: 360, endMinute: 600 }, { weekday: d, startMinute: 1020, endMinute: 1380 }]),
    ...[0, 6].map((d) => ({ weekday: d, startMinute: 480, endMinute: 1320 })),
  ] },
  { id: 'business', label: 'Business hours on weekdays (LinkedIn)', build: () => [1, 2, 3, 4, 5].map((d) => ({ weekday: d, startMinute: 450, endMinute: 1080 })) },
];

function RulesEditor({ rules, onChange }: { rules: Rule[]; onChange: (r: Rule[]) => void }) {
  const setDay = (day: number, blocks: Rule[]) => onChange([...rules.filter((r) => r.weekday !== day), ...blocks].sort((a, b) => a.weekday - b.weekday || a.startMinute - b.startMinute));
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-1.5">
        {RULE_PRESETS.map((p) => <Button key={p.id} size="sm" onClick={() => onChange(p.build())}>{p.label}</Button>)}
        <Button size="sm" variant="ghost" onClick={() => onChange([])}>Any time</Button>
      </div>
      {!rules.length ? <p className="text-[11px] text-zinc-500">No posting hours set: this account can post at any time.</p> : null}
      <div className="space-y-1">
        {WEEKDAYS.map((name, day) => {
          const blocks = rules.filter((r) => r.weekday === day);
          return (
            <div key={day} className="flex flex-wrap items-center gap-1.5 text-xs">
              <span className="w-10 shrink-0 font-medium text-zinc-600 dark:text-zinc-400">{name}</span>
              {blocks.length === 0 ? <span className="text-zinc-400">{rules.length ? 'No posting' : ''}</span> : null}
              {blocks.map((b, i) => (
                <span key={i} className="inline-flex items-center gap-1 rounded border border-zinc-200 px-1 dark:border-zinc-800">
                  <input type="time" aria-label={`${name} block ${i + 1} start`} className="bg-transparent text-xs" value={toTime(b.startMinute)}
                    onChange={(e) => setDay(day, blocks.map((x, j) => j === i ? { ...x, startMinute: fromTime(e.target.value) } : x))} />
                  <span className="text-zinc-400">to</span>
                  <input type="time" aria-label={`${name} block ${i + 1} end`} className="bg-transparent text-xs" value={toTime(b.endMinute)}
                    onChange={(e) => setDay(day, blocks.map((x, j) => j === i ? { ...x, endMinute: fromTime(e.target.value, true) } : x))} />
                  <button type="button" aria-label="Remove block" className="text-zinc-400 hover:text-red-600" onClick={() => setDay(day, blocks.filter((_, j) => j !== i))}>
                    <Trash2 className="h-3 w-3" />
                  </button>
                </span>
              ))}
              <button type="button" className="inline-flex items-center gap-0.5 text-accent-700 hover:underline dark:text-accent-400"
                onClick={() => setDay(day, [...blocks, { weekday: day, startMinute: 1020, endMinute: 1320 }])}>
                <Plus className="h-3 w-3" />block
              </button>
              {day === 1 && blocks.length ? (
                <button type="button" className="text-zinc-500 hover:underline"
                  onClick={() => onChange([...rules.filter((r) => r.weekday === 0 || r.weekday === 6 || r.weekday === 1),
                    ...[2, 3, 4, 5].flatMap((d) => blocks.map((b) => ({ ...b, weekday: d })))].sort((a, b) => a.weekday - b.weekday || a.startMinute - b.startMinute))}>
                  copy to Tue to Fri
                </button>
              ) : null}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function rulesSummary(rules: Rule[]): string {
  if (!rules.length) return 'Any time';
  return WEEKDAYS.map((n, d) => {
    const b = rules.filter((r) => r.weekday === d);
    return b.length ? `${n} ${b.map((x) => `${minuteLabel(x.startMinute)}-${minuteLabel(x.endMinute)}`).join(', ')}` : null;
  }).filter(Boolean).join(' · ');
}

/* ---------------------------------------------------------------- targets */

type Draft = {
  id?: string; brand: string; platform: PublishPlatform; label: string; handle: string; provider: PublishProvider;
  secret: Record<string, string> | null | undefined; channelId: string; utm: Target['utm']; rules: Rule[];
  minGapMinutes: number; maxPerDay: string; active: boolean;
};

const blank = (): Draft => ({
  brand: '', platform: 'facebook', label: '', handle: '', provider: 'ayrshare', secret: undefined, channelId: '',
  utm: {}, rules: [], minGapMinutes: 30, maxPerDay: '', active: true,
});

const fromTarget = (t: Target): Draft => ({
  id: t.id, brand: t.brand, platform: t.platform, label: t.label, handle: t.handle ?? '', provider: t.provider,
  secret: undefined, channelId: t.channel_id ?? '', utm: t.utm ?? {}, rules: t.rules ?? [], minGapMinutes: t.min_gap_minutes,
  maxPerDay: t.max_per_day ? String(t.max_per_day) : '', active: t.active,
});

function TargetEditor({ draft, channels, hasSecret, onSaved, onCancel }: {
  draft: Draft; channels: Channel[]; hasSecret: boolean; onSaved: () => void; onCancel: () => void;
}) {
  const [d, setD] = React.useState(draft);
  const [error, setError] = React.useState<string | null>(null);
  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => setD({ ...d, [k]: v });
  const save = async () => {
    setError(null);
    try {
      const json = {
        brand: d.brand, platform: d.platform, label: d.label, handle: d.handle || null, provider: d.provider,
        ...(d.secret !== undefined ? { secret: d.secret } : {}),
        channelId: d.channelId || null, utm: Object.fromEntries(Object.entries(d.utm).filter(([, v]) => v)),
        rules: d.rules, minGapMinutes: d.minGapMinutes, maxPerDay: d.maxPerDay ? Number(d.maxPerDay) : null,
        active: d.active,
      };
      if (d.id) await api(`/api/publishing/targets/${d.id}`, { method: 'PUT', json });
      else await api('/api/publishing/targets', { method: 'POST', json });
      onSaved();
    } catch (e) { setError((e as Error).message); }
  };
  const def = DEFAULT_UTM[d.platform];
  const mode = linkModeFor(d.platform, d.provider);
  const platformChannels = channels.filter((c) => c.platform === d.platform);

  return (
    <div className="space-y-5 rounded-md border border-zinc-200 p-4 dark:border-zinc-800">
      <div className="grid gap-3 sm:grid-cols-4">
        <Field label="Brand"><Input value={d.brand} onChange={(e) => set('brand', e.target.value)} placeholder="Boston.com" /></Field>
        <Field label="Platform">
          <Select value={d.platform} onChange={(e) => {
            const platform = e.target.value as PublishPlatform;
            setD({ ...d, platform, provider: platform === 'bluesky' ? 'bluesky' : d.provider === 'bluesky' ? 'ayrshare' : d.provider, secret: undefined });
          }}
            options={PUBLISH_PLATFORMS.map((p) => ({ value: p, label: PUBLISH_PLATFORM_LABELS[p] }))} />
        </Field>
        <Field label="Account name"><Input value={d.label} onChange={(e) => set('label', e.target.value)} placeholder="Main" /></Field>
        <Field label="Handle"><Input value={d.handle} onChange={(e) => set('handle', e.target.value)} placeholder="@bostondotcom" /></Field>
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <Field label="Sent through" hint={mode === 'card' ? 'Story links post as a card; the URL stays out of the text.' : mode === 'none' ? 'Captions here cannot carry clickable links, so none is added.' : 'Story links are added to the text.'}>
          <Select value={d.provider} onChange={(e) => setD({ ...d, provider: e.target.value as PublishProvider, secret: undefined })}
            options={(d.platform === 'bluesky' ? ['bluesky', 'ayrshare', 'mock'] as const : ['ayrshare', 'mock'] as const)
              .map((p) => ({ value: p, label: PROVIDER_LABEL[p] }))} />
        </Field>
        {d.provider === 'ayrshare' ? (
          <Field label="Ayrshare profile key" hint={hasSecret && d.secret === undefined ? 'Saved. Type to replace.' : 'From the brand’s profile in Ayrshare. Stored encrypted.'}>
            <Input type="password" autoComplete="off" value={d.secret?.profileKey ?? ''} onChange={(e) => set('secret', e.target.value ? { profileKey: e.target.value } : undefined)} />
          </Field>
        ) : d.provider === 'bluesky' ? (
          <>
            <Field label="Bluesky handle"><Input value={d.secret?.identifier ?? ''} placeholder={hasSecret ? 'Saved' : 'bostondotcom.bsky.social'}
              onChange={(e) => set('secret', { ...(d.secret ?? {}), identifier: e.target.value })} /></Field>
            <Field label="App password" hint="Bluesky Settings, App passwords. Never the account password.">
              <Input type="password" autoComplete="off" value={d.secret?.appPassword ?? ''} onChange={(e) => set('secret', { ...(d.secret ?? {}), appPassword: e.target.value })} />
            </Field>
          </>
        ) : null}
      </div>

      <div>
        <p className="mb-2 text-xs font-medium text-zinc-700 dark:text-zinc-300">Posting hours (Boston time)</p>
        <RulesEditor rules={d.rules} onChange={(r) => set('rules', r)} />
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <Field label="Minimum gap between posts" hint="Minutes. Window scheduling never puts two posts closer than this.">
          <Input type="number" min={0} value={d.minGapMinutes} onChange={(e) => set('minGapMinutes', Number(e.target.value))} />
        </Field>
        <Field label="Daily cap" hint="Optional. Posts per day on this account.">
          <Input type="number" min={1} value={d.maxPerDay} onChange={(e) => set('maxPerDay', e.target.value)} />
        </Field>
        <Field label="Learn best hours from" hint="This account’s tracked channel. Its last 120 days of engagement rate weight the slot picker.">
          <Select value={d.channelId} onChange={(e) => set('channelId', e.target.value)}
            options={[{ value: '', label: 'No history (spacing only)' }, ...platformChannels.map((c) => ({ value: c.id, label: `${c.company} · ${c.handle}` }))]} />
        </Field>
      </div>

      <div>
        <p className="mb-2 text-xs font-medium text-zinc-700 dark:text-zinc-300">UTM tags</p>
        <div className="grid gap-2 sm:grid-cols-4">
          {(['source', 'medium', 'campaign', 'content'] as const).map((k) => (
            <Field key={k} label={'utm_' + k}>
              <Input value={d.utm[k] ?? ''} placeholder={k === 'content' ? '{post}' : def[k as 'source' | 'medium' | 'campaign']}
                onChange={(e) => set('utm', { ...d.utm, [k]: e.target.value })} />
            </Field>
          ))}
        </div>
        <p className="mt-1 text-[11px] text-zinc-500">Blank uses the default shown. Placeholders: {'{brand} {platform} {post} {date} {origin}'}. Tags already on a link are never overwritten.</p>
      </div>


      <div className="flex flex-wrap items-center gap-3">
        <Toggle checked={d.active} onChange={(v) => set('active', v)} label="Active" />
        <Button variant="primary" onClick={save} disabled={!d.brand || !d.label}>Save account</Button>
        <Button variant="ghost" onClick={onCancel}>Cancel</Button>
        {error ? <span className="text-xs text-red-600">{error}</span> : null}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ feeds */

function FeedEditor({ feed, targets, onSaved, onCancel }: { feed: Feed | null; targets: Target[]; onSaved: () => void; onCancel: () => void }) {
  const [label, setLabel] = React.useState(feed?.label ?? '');
  const [url, setUrl] = React.useState(feed?.url ?? '');
  const [ids, setIds] = React.useState<string[]>(feed?.target_ids ?? []);
  const [templates, setTemplates] = React.useState<Record<string, string>>(feed?.templates ?? { default: '{title}' });
  const [windowMinutes, setWindow] = React.useState(feed?.window_minutes ?? 120);
  const [approval, setApproval] = React.useState(feed?.require_approval ?? false);
  const [active, setActive] = React.useState(feed?.active ?? true);
  const [include, setInclude] = React.useState((feed?.include_categories ?? []).join(', '));
  const [exclude, setExclude] = React.useState((feed?.exclude_keywords ?? []).join(', '));
  const [error, setError] = React.useState<string | null>(null);
  const platforms = [...new Set(targets.filter((t) => ids.includes(t.id)).map((t) => t.platform))];

  const save = async () => {
    setError(null);
    const list = (v: string) => v.split(',').map((x) => x.trim()).filter(Boolean);
    const json = { label, url, targetIds: ids, templates, windowMinutes, requireApproval: approval, active,
      includeCategories: list(include), excludeKeywords: list(exclude) };
    try {
      if (feed) await api(`/api/publishing/feeds/${feed.id}`, { method: 'PUT', json });
      else await api('/api/publishing/feeds', { method: 'POST', json });
      onSaved();
    } catch (e) { setError((e as Error).message); }
  };

  return (
    <div className="space-y-4 rounded-md border border-zinc-200 p-4 dark:border-zinc-800">
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Name"><Input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Boston.com local news" /></Field>
        <Field label="Feed URL" hint="WordPress: any category or tag URL followed by /feed/."><Input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://www.boston.com/category/news/local-news/feed/" /></Field>
      </div>
      <div>
        <p className="mb-1.5 text-xs font-medium text-zinc-700 dark:text-zinc-300">Post to</p>
        <div className="flex flex-wrap gap-1.5">
          {targets.map((t) => {
            const on = ids.includes(t.id);
            return (
              <Button key={t.id} size="sm" variant={on ? 'primary' : 'secondary'} onClick={() => setIds(on ? ids.filter((x) => x !== t.id) : [...ids, t.id])}>
                <PlatformIcon platform={t.platform} className={on ? 'text-white' : undefined} />{t.brand} · {t.label}
              </Button>
            );
          })}
        </div>
      </div>
      <div className="space-y-2">
        <p className="text-xs font-medium text-zinc-700 dark:text-zinc-300">Copy by platform</p>
        <p className="text-[11px] text-zinc-500">Fields: {'{title} {description} {category}'}. The link is added the right way for each platform, so leave it out.</p>
        {(['default', ...platforms] as string[]).map((k) => (
          <div key={k} className="grid gap-2 sm:grid-cols-[7rem_1fr]">
            <span className="pt-2 text-xs text-zinc-600 dark:text-zinc-400">{k === 'default' ? 'Default' : PUBLISH_PLATFORM_LABELS[k as PublishPlatform]}</span>
            <Textarea rows={2} value={templates[k] ?? ''} placeholder={k === 'default' ? '{title}' : 'Same as default'}
              onChange={(e) => setTemplates({ ...templates, [k]: e.target.value })} />
          </div>
        ))}
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Only these sections" hint="RSS categories, comma separated. Blank posts everything in the feed.">
          <Input value={include} onChange={(e) => setInclude(e.target.value)} placeholder="Local News, Sports" />
        </Field>
        <Field label="Never autopost stories containing" hint="Words or phrases, comma separated. Matching stories wait for a person.">
          <Input value={exclude} onChange={(e) => setExclude(e.target.value)} placeholder="obituary, sponsored, shooting" />
        </Field>
      </div>
      <div className="grid gap-3 sm:grid-cols-3">
        <Field label="Post within" hint="Minutes after the story appears. Each account picks its best slot inside its posting hours.">
          <Input type="number" min={5} value={windowMinutes} onChange={(e) => setWindow(Number(e.target.value))} />
        </Field>
        <div className="flex items-end"><Toggle checked={approval} onChange={setApproval} label="Needs review before posting" /></div>
        <div className="flex items-end"><Toggle checked={active} onChange={setActive} label="Active" /></div>
      </div>
      <p className="text-[11px] text-zinc-500">When a feed is switched on, stories already in it are recorded, not posted. Only new stories go out.</p>
      <div className="flex items-center gap-3">
        <Button variant="primary" onClick={save} disabled={!label || !url || !ids.length}>Save feed</Button>
        <Button variant="ghost" onClick={onCancel}>Cancel</Button>
        {error ? <span className="text-xs text-red-600">{error}</span> : null}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------- page */

export function PublishingSettings({ section }: { section: 'accounts' | 'feeds' }) {
  const { canApprove, refresh: refreshShell } = usePublish();
  const [targets, setTargets] = React.useState<Target[]>([]);
  const [channels, setChannels] = React.useState<Channel[]>([]);
  const [feeds, setFeeds] = React.useState<Feed[]>([]);
  const [editing, setEditing] = React.useState<Draft | null>(null);
  const [editingFeed, setEditingFeed] = React.useState<Feed | 'new' | null>(null);
  const [error, setError] = React.useState<string | null>(null);

  const load = React.useCallback(async () => {
    try {
      const [t, c, f] = await Promise.all([
        api<{ targets: Target[] }>('/api/publishing/targets'),
        api<{ channels: Channel[] }>('/api/publishing/channels'),
        api<{ feeds: Feed[] }>('/api/publishing/feeds'),
      ]);
      setTargets(t.targets); setChannels(c.channels); setFeeds(f.feeds); setError(null);
      refreshShell();
    } catch (e) { setError((e as Error).message); }
  }, [refreshShell]);
  // Deferred a tick so the effect itself sets no state (react-hooks rule).
  React.useEffect(() => { void Promise.resolve().then(load); }, [load]);

  return (
    <div className="space-y-4">
      {error ? <p className="text-sm text-red-600">{error}</p> : null}
      {section === 'accounts' ? (
      <Card>
        <CardHeader>
          <div>
            <CardTitle>Accounts</CardTitle>
            <CardDescription>The social accounts you can post to, and the rules each one follows: when it may post, how far apart, and how links are tagged.</CardDescription>
          </div>
          {canApprove && !editing ? <Button size="sm" variant="primary" onClick={() => setEditing(blank())}><Plus className="h-3.5 w-3.5" />Add account</Button> : null}
        </CardHeader>
        <CardBody className="space-y-3">
          {editing && !editing.id ? (
            <TargetEditor draft={editing} channels={channels} hasSecret={false} onCancel={() => setEditing(null)} onSaved={() => { setEditing(null); load(); }} />
          ) : null}
          <ul className="divide-y divide-zinc-100 dark:divide-zinc-800">
            {targets.map((t) => (
              <li key={t.id} className="py-3">
                {editing?.id === t.id ? (
                  <TargetEditor draft={editing} channels={channels} hasSecret={t.has_secret} onCancel={() => setEditing(null)} onSaved={() => { setEditing(null); load(); }} />
                ) : (
                  <div className="flex flex-col gap-1 text-xs sm:flex-row sm:items-center sm:gap-3">
                    <span className="flex w-56 shrink-0 items-center gap-1.5 font-medium">
                      <PlatformIcon platform={t.platform} />{t.brand} · {accountName(t)}
                    </span>
                    <span className="flex flex-wrap gap-1.5">
                      <Badge tone={t.provider === 'mock' ? 'outline' : 'neutral'}>{PROVIDER_LABEL[t.provider]}</Badge>
                      {t.provider !== 'mock' && !t.has_secret ? <Badge tone="warning">No credentials</Badge> : null}
                      {!t.active ? <Badge tone="outline">Paused</Badge> : null}
                      {t.channel_id ? <Badge tone="accent">Uses past performance</Badge> : null}
                    </span>
                    <span className="min-w-0 flex-1 truncate text-zinc-500" title={rulesSummary(t.rules)}>
                      {t.rules.length ? `Posts ${rulesSummary(t.rules)}` : 'Posts any time'} · at least {t.min_gap_minutes} min apart{t.max_per_day ? ` · up to ${t.max_per_day} a day` : ''}
                    </span>
                    {canApprove ? <Button size="sm" variant="ghost" onClick={() => setEditing(fromTarget(t))}>Edit</Button> : null}
                  </div>
                )}
              </li>
            ))}
            {!targets.length && !editing ? <li className="py-6 text-center text-sm text-zinc-500">No accounts yet.</li> : null}
          </ul>
        </CardBody>
      </Card>
      ) : (
      <Card>
        <CardHeader>
          <div>
            <CardTitle>RSS auto-post</CardTitle>
            <CardDescription>When a new story appears in one of these feeds, it is posted to the accounts you choose at each one&apos;s next good time. Pause posting stops these too.</CardDescription>
          </div>
          {canApprove && !editingFeed ? <Button size="sm" variant="primary" disabled={!targets.length} onClick={() => setEditingFeed('new')}><Plus className="h-3.5 w-3.5" />Add feed</Button> : null}
        </CardHeader>
        <CardBody className="space-y-3">
          {editingFeed === 'new' ? <FeedEditor feed={null} targets={targets} onCancel={() => setEditingFeed(null)} onSaved={() => { setEditingFeed(null); load(); }} /> : null}
          <ul className="divide-y divide-zinc-100 dark:divide-zinc-800">
            {feeds.map((f) => (
              <li key={f.id} className="py-3">
                {editingFeed !== 'new' && editingFeed?.id === f.id ? (
                  <FeedEditor feed={f} targets={targets} onCancel={() => setEditingFeed(null)} onSaved={() => { setEditingFeed(null); load(); }} />
                ) : (
                  <div className="flex flex-col gap-1 text-xs sm:flex-row sm:items-center sm:gap-3">
                    <span className="w-56 shrink-0 font-medium">{f.label}</span>
                    <span className="flex flex-wrap gap-1.5">
                      <Badge tone={f.active ? 'positive' : 'outline'}>{f.active ? 'On' : 'Off'}</Badge>
                      {f.require_approval ? <Badge tone="warning">Approval</Badge> : null}
                      <Badge tone="neutral">{f.target_ids.length} accounts</Badge>
                      <Badge tone="neutral">within {f.window_minutes}m</Badge>
                      {f.include_categories?.length ? <Badge tone="neutral">{f.include_categories.length} section{f.include_categories.length === 1 ? '' : 's'}</Badge> : null}
                      {f.exclude_keywords?.length ? <Badge tone="neutral">{f.exclude_keywords.length} blocked word{f.exclude_keywords.length === 1 ? '' : 's'}</Badge> : null}
                    </span>
                    <span className="min-w-0 flex-1 truncate text-zinc-500">
                      {f.last_error ? <span className="text-red-600">{f.last_error}</span> : f.last_polled_at ? `Checked ${fmtWhen(f.last_polled_at)}` : 'Not checked yet'}
                    </span>
                    {canApprove ? <Button size="sm" variant="ghost" onClick={() => setEditingFeed(f)}>Edit</Button> : null}
                  </div>
                )}
                {f.recent?.length && !(editingFeed !== 'new' && editingFeed?.id === f.id) ? (
                  <ul className="mt-2 space-y-1 rounded-md bg-zinc-50 p-2 text-xs dark:bg-zinc-900/60">
                    {f.recent.map((r, i) => (
                      <li key={i} className="flex items-baseline gap-2">
                        <span className="pb-num w-16 shrink-0 text-zinc-400">{fmtTime(r.seen_at)}</span>
                        <a href={r.link ?? undefined} target="_blank" rel="noreferrer" className="min-w-0 flex-1 truncate hover:underline">{r.title}</a>
                        <span className={r.outcome === 'Queued' ? 'shrink-0 font-medium text-emerald-700 dark:text-emerald-400' : 'shrink-0 text-zinc-500'}>{r.outcome}</span>
                      </li>
                    ))}
                  </ul>
                ) : null}
              </li>
            ))}
            {!feeds.length && editingFeed !== 'new' ? <li className="py-6 text-center text-sm text-zinc-500">No feeds yet.</li> : null}
          </ul>
        </CardBody>
      </Card>
      )}
    </div>
  );
}
