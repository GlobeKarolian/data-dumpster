'use client';

import * as React from 'react';
import { AlertTriangle, ExternalLink, Pencil, RotateCcw, Sparkles, Zap } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input, Textarea } from '@/components/ui/input';
import { PlatformIcon } from '@/components/ui/platform-icon';
import { cn } from '@/lib/utils';
import { chargedLength, PUBLISH_PLATFORM_LABELS, TEXT_LIMITS } from '@/lib/publishing/platforms';
import { api, dayKey, dayLabel, fmtTime, fmtWhen, toLocalInput, type Delivery, type Post, type Target } from './api';
import { usePublish } from './shell';

/**
 * The desk's home screen, laid out the way SocialFlow trained social editors to
 * read it: accounts on the left, what is coming up in the middle, what already
 * went out on the right. Anything waiting on a human (approval, held, failed)
 * sits at the top of the middle column so it cannot be missed.
 */

type Row = { p: Post; d: Delivery };

function modeOf(p: Post): { label: string; tone: 'accent' | 'neutral' | 'outline'; icon?: React.ReactNode } {
  if (p.origin === 'rss') return { label: 'Autopilot', tone: 'neutral', icon: <Zap className="h-3 w-3" /> };
  if (p.timing.mode === 'window') return { label: p.timing.priority === 'can' ? 'Optimized · can send' : 'Optimized', tone: 'accent', icon: <Sparkles className="h-3 w-3" /> };
  return { label: 'Scheduled', tone: 'outline' };
}

function useBoardData(version: number) {
  const [posts, setPosts] = React.useState<Post[] | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [tick, setTick] = React.useState(0);
  React.useEffect(() => {
    let cancelled = false;
    const from = new Date(Date.now() - 2 * 86400_000).toISOString();
    const to = new Date(Date.now() + 14 * 86400_000).toISOString();
    void api<{ posts: Post[] }>(`/api/publishing/posts?from=${from}&to=${to}`)
      .then((r) => { if (!cancelled) { setPosts(r.posts); setError(null); } })
      .catch((e) => { if (!cancelled) setError((e as Error).message); });
    return () => { cancelled = true; };
  }, [version, tick]);
  React.useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), 30_000);
    return () => clearInterval(id);
  }, []);
  return { posts, error };
}

export function QueueBoard() {
  const { targets, version, refresh, canApprove, me, openComposer, toast } = usePublish();
  const { posts, error } = useBoardData(version);
  const [account, setAccount] = React.useState<string | null>(null);
  const [label, setLabel] = React.useState<string | null>(null);

  const rows: Row[] = (posts ?? []).flatMap((p) => p.deliveries.map((d) => ({ p, d })));
  const visible = rows.filter((r) => (!account || r.d.target_id === account) && (!label || (r.p.options?.labels ?? []).includes(label)));
  const upcoming = visible.filter((r) => r.d.status === 'queued' || r.d.status === 'sending')
    .sort((a, b) => (a.d.scheduled_for ?? '').localeCompare(b.d.scheduled_for ?? ''));
  const sent = visible.filter((r) => r.d.status === 'sent')
    .sort((a, b) => (b.d.sent_at ?? '').localeCompare(a.d.sent_at ?? ''));
  const attention = visible.filter((r) => r.d.status === 'failed' || r.d.status === 'unschedulable');
  const waiting = (posts ?? []).filter((p) => (p.status === 'pending_approval' || p.status === 'draft')
    && (!account || p.deliveries.some((d) => d.target_id === account)));
  const labels = [...new Set((posts ?? []).flatMap((p) => p.options?.labels ?? []))].sort();

  const counts = new Map<string, number>();
  for (const r of rows) if (r.d.status === 'queued') counts.set(r.d.target_id, (counts.get(r.d.target_id) ?? 0) + 1);

  const act = async (url: string, json: unknown, ok: string) => {
    try { await api(url, { method: 'PATCH', json }); toast(ok); refresh(); }
    catch (e) { toast((e as Error).message); }
  };

  const recycle = (p: Post) => openComposer({
    targetIds: p.deliveries.map((d) => d.target_id),
    copy: p.base_copy, link: p.link_url ?? '', linkTitle: p.link_title ?? '', media: p.media_urls, labels: p.options?.labels,
  });

  const byDay = new Map<string, Row[]>();
  for (const r of upcoming) {
    const k = dayKey(r.d.scheduled_for!);
    byDay.set(k, [...(byDay.get(k) ?? []), r]);
  }

  return (
    <div className="grid gap-4 lg:grid-cols-[220px_minmax(0,1fr)_minmax(0,0.85fr)]">
      <AccountRail targets={targets} counts={counts} account={account} onAccount={setAccount}
        labels={labels} label={label} onLabel={setLabel} />

      <section className="min-w-0 space-y-4">
        {error ? <p className="text-sm text-red-600">{error}</p> : null}

        {waiting.length ? (
          <Column title="Waiting on you" count={waiting.length} tone="amber">
            {waiting.map((p) => (
              <div key={p.id} className="space-y-2 p-3">
                <div className="flex flex-wrap items-center gap-1.5">
                  <Badge tone={p.status === 'draft' ? 'outline' : 'warning'}>{p.status === 'draft' ? 'Held' : 'Needs approval'}</Badge>
                  {p.deliveries.map((d) => <PlatformIcon key={d.id} platform={d.platform} />)}
                  <span className="text-[11px] text-zinc-500">{p.created_by_email?.replace(/^rss:/, 'Autopilot: ')}</span>
                </div>
                <PostText p={p} />
                {p.notes ? <p className="text-[11px] text-amber-700 dark:text-amber-400">{p.notes}</p> : null}
                <div className="flex gap-1.5">
                  {canApprove ? (
                    <Button size="sm" variant="primary" onClick={() => act(`/api/publishing/posts/${p.id}`, { action: 'approve' }, 'Released to the queue.')}>
                      {p.status === 'draft' ? 'Release' : 'Approve'}
                    </Button>
                  ) : null}
                  {canApprove || p.created_by_email === me ? (
                    <Button size="sm" variant="ghost" onClick={() => act(`/api/publishing/posts/${p.id}`, { action: 'cancel' }, 'Discarded.')}>Discard</Button>
                  ) : null}
                </div>
              </div>
            ))}
          </Column>
        ) : null}

        {attention.length ? (
          <Column title="Needs attention" count={attention.length} tone="red">
            {attention.map((r) => <QueueItem key={r.d.id} row={r} canApprove={canApprove} onAct={act} />)}
          </Column>
        ) : null}

        <Column title="Up next" count={upcoming.length}>
          {posts === null ? (
            <p className="p-6 text-center text-sm text-zinc-400">Loading…</p>
          ) : !upcoming.length ? (
            <div className="space-y-3 p-10 text-center">
              <p className="text-sm text-zinc-500">Nothing queued{account ? ' for this account' : ''}.</p>
              <Button size="sm" variant="primary" onClick={() => openComposer(account ? { targetIds: [account] } : undefined)}>New post</Button>
            </div>
          ) : [...byDay.entries()].map(([k, list]) => (
            <div key={k}>
              <p className="sticky top-14 z-10 bg-zinc-50/95 px-3 py-1.5 text-[11px] font-semibold uppercase tracking-wide text-zinc-500 backdrop-blur dark:bg-zinc-900/95">
                {dayLabel(k)}
              </p>
              {list.map((r) => <QueueItem key={r.d.id} row={r} canApprove={canApprove} onAct={act} />)}
            </div>
          ))}
        </Column>
      </section>

      <section className="min-w-0">
        <Column title="Published" count={sent.length} note="Last two days">
          {!sent.length ? (
            <p className="p-6 text-center text-sm text-zinc-400">Nothing sent yet.</p>
          ) : sent.map(({ p, d }) => (
            <article key={d.id} className="space-y-1.5 p-3">
              <div className="flex items-center gap-1.5 text-[11px] text-zinc-500">
                <PlatformIcon platform={d.platform} />
                <span className="font-medium text-zinc-700 dark:text-zinc-300">{d.brand}</span>
                <span>{d.sent_at ? fmtTime(d.sent_at) : ''}</span>
                {d.provider === 'mock' ? <Badge tone="outline">test</Badge> : null}
                <span className="ml-auto flex gap-1">
                  <Button size="sm" variant="ghost" onClick={() => recycle(p)} title="Post this again"><RotateCcw className="h-3 w-3" /> Recycle</Button>
                  {d.post_url ? (
                    <a href={d.post_url} target="_blank" rel="noreferrer" className="inline-flex h-7 items-center gap-1 px-1.5 text-xs text-accent-700 hover:underline dark:text-accent-400">
                      View <ExternalLink className="h-3 w-3" />
                    </a>
                  ) : null}
                </span>
              </div>
              <p className="line-clamp-3 whitespace-pre-wrap break-words text-[13px] text-zinc-800 dark:text-zinc-200">{d.final_text}</p>
            </article>
          ))}
        </Column>
      </section>
    </div>
  );
}

function AccountRail({ targets, counts, account, onAccount, labels, label, onLabel }: {
  targets: Target[]; counts: Map<string, number>; account: string | null; onAccount: (id: string | null) => void;
  labels: string[]; label: string | null; onLabel: (l: string | null) => void;
}) {
  const brands = new Map<string, Target[]>();
  for (const t of targets) brands.set(t.brand, [...(brands.get(t.brand) ?? []), t]);
  const item = (active: boolean) => cn('flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[13px] transition-colors',
    active ? 'bg-white font-medium text-zinc-900 shadow-sm dark:bg-zinc-800 dark:text-zinc-50' : 'text-zinc-600 hover:bg-white/70 dark:text-zinc-400 dark:hover:bg-zinc-900');
  return (
    <>
    <div className="flex gap-1.5 overflow-x-auto pb-1 lg:hidden">
      <button type="button" onClick={() => onAccount(null)}
        className={cn('shrink-0 rounded-full border px-3 py-1 text-xs', account === null ? 'border-accent-600 bg-accent-600/10' : 'border-zinc-200 dark:border-zinc-800')}>All</button>
      {targets.map((t) => (
        <button key={t.id} type="button" onClick={() => onAccount(t.id)}
          className={cn('inline-flex shrink-0 items-center gap-1 rounded-full border px-3 py-1 text-xs', account === t.id ? 'border-accent-600 bg-accent-600/10' : 'border-zinc-200 dark:border-zinc-800')}>
          <PlatformIcon platform={t.platform} />{t.brand}
        </button>
      ))}
    </div>
    <aside className="hidden space-y-4 lg:sticky lg:top-20 lg:block lg:self-start">
      <div className="space-y-0.5">
        <button type="button" className={item(account === null)} onClick={() => onAccount(null)}>All accounts</button>
        {[...brands.entries()].map(([brand, ts]) => (
          <div key={brand} className="pt-2">
            <p className="px-2 pb-1 text-[10px] font-semibold uppercase tracking-[0.12em] text-zinc-400">{brand}</p>
            {ts.map((t) => (
              <button key={t.id} type="button" className={item(account === t.id)} onClick={() => onAccount(t.id)}>
                <PlatformIcon platform={t.platform} />
                <span className="flex-1 truncate">{t.label === 'Main' ? PUBLISH_PLATFORM_LABELS[t.platform] : `${PUBLISH_PLATFORM_LABELS[t.platform]} · ${t.label}`}</span>
                {!t.active ? <span className="text-[10px] text-zinc-400">paused</span> : null}
                {counts.get(t.id) ? <span className="pb-num rounded bg-zinc-200 px-1 text-[10px] dark:bg-zinc-700">{counts.get(t.id)}</span> : null}
              </button>
            ))}
          </div>
        ))}
      </div>
      {labels.length ? (
        <div>
          <p className="px-2 pb-1 text-[10px] font-semibold uppercase tracking-[0.12em] text-zinc-400">Labels</p>
          <div className="flex flex-wrap gap-1 px-1">
            {labels.map((l) => (
              <button key={l} type="button" onClick={() => onLabel(label === l ? null : l)}
                className={cn('rounded-full border px-2 py-0.5 text-[11px]', label === l ? 'border-accent-600 bg-accent-600/10' : 'border-zinc-200 text-zinc-500 dark:border-zinc-800')}>
                {l}
              </button>
            ))}
          </div>
        </div>
      ) : null}
    </aside>
    </>
  );
}

function Column({ title, count, note, tone, children }: {
  title: string; count?: number; note?: string; tone?: 'amber' | 'red'; children: React.ReactNode;
}) {
  return (
    <div className={cn('overflow-hidden rounded-lg border bg-white dark:bg-zinc-900/40',
      tone === 'amber' ? 'border-amber-300 dark:border-amber-800' : tone === 'red' ? 'border-red-300 dark:border-red-900' : 'border-zinc-200 dark:border-zinc-800')}>
      <header className="flex items-baseline gap-2 border-b border-zinc-200 px-3 py-2.5 dark:border-zinc-800">
        <h2 className="text-sm font-semibold">{title}</h2>
        {typeof count === 'number' ? <span className="pb-num text-xs text-zinc-400">{count}</span> : null}
        {note ? <span className="ml-auto text-[11px] text-zinc-400">{note}</span> : null}
      </header>
      <div className="divide-y divide-zinc-100 dark:divide-zinc-800">{children}</div>
    </div>
  );
}

function PostText({ p }: { p: Post }) {
  return (
    <div className="min-w-0">
      <p className="line-clamp-2 text-[13px] text-zinc-900 dark:text-zinc-100">{p.base_copy || p.link_title || p.link_url}</p>
      {p.link_url ? <p className="truncate text-[11px] text-zinc-400">{p.link_url}</p> : null}
    </div>
  );
}

function QueueItem({ row, canApprove, onAct }: {
  row: Row; canApprove: boolean; onAct: (url: string, json: unknown, ok: string) => Promise<void>;
}) {
  const { p, d } = row;
  const [mode, setMode] = React.useState<'view' | 'edit' | 'move'>('view');
  const [text, setText] = React.useState(d.final_text);
  const [when, setWhen] = React.useState(() => toLocalInput(d.scheduled_for ? new Date(d.scheduled_for) : new Date()));
  const m = modeOf(p);
  const len = chargedLength(d.platform, text);
  const limit = TEXT_LIMITS[d.platform];
  const editable = canApprove && ['queued', 'failed', 'unschedulable'].includes(d.status);
  const url = `/api/publishing/deliveries/${d.id}`;

  return (
    <article className="group relative grid grid-cols-[4.5rem_minmax(0,1fr)] gap-3 p-3">
      <div className="space-y-1 text-right">
        <p className="pb-num text-sm font-semibold text-zinc-900 dark:text-zinc-100">{d.scheduled_for ? fmtTime(d.scheduled_for) : '—'}</p>
        <p className="flex items-center justify-end gap-1 text-[11px] text-zinc-500"><PlatformIcon platform={d.platform} className="h-3 w-3" />{d.brand}</p>
      </div>
      <div className="min-w-0 space-y-1.5">
        {mode === 'edit' ? (
          <div className="space-y-1.5">
            <Textarea rows={4} value={text} onChange={(e) => setText(e.target.value)} className="text-[13px]" />
            <div className="flex items-center gap-1.5">
              <Button size="sm" variant="primary" disabled={len > limit}
                onClick={async () => { await onAct(url, { action: 'edit', text }, 'Saved.'); setMode('view'); }}>Save</Button>
              <Button size="sm" variant="ghost" onClick={() => { setText(d.final_text); setMode('view'); }}>Cancel</Button>
              <span className={cn('pb-num ml-auto text-[11px]', len > limit ? 'text-red-600' : 'text-zinc-400')}>{len}/{limit}</span>
            </div>
          </div>
        ) : (
          <p className="whitespace-pre-wrap break-words text-[13px] text-zinc-800 dark:text-zinc-200">{d.final_text}</p>
        )}
        {d.link_url && d.link_mode !== 'text' ? (
          <p className="truncate text-[11px] text-zinc-400">{d.link_mode === 'card' ? 'Card: ' : 'Bio: '}{d.link_url}</p>
        ) : null}
        <div className="flex flex-wrap items-center gap-1.5 text-[11px]">
          <Badge tone={m.tone}>{m.icon}{m.label}</Badge>
          {(p.options?.labels ?? []).map((l) => <Badge key={l} tone="neutral">{l}</Badge>)}
          {d.slot_reason ? <span className="text-zinc-500">{d.slot_reason.replace(/^[A-Z][a-z]{2} \d{1,2}(:\d{2})?[ap]m: /, '')}</span> : null}
        </div>
        {d.last_error ? (
          <p className="flex items-start gap-1 text-[11px] text-red-600 dark:text-red-400"><AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" />{d.last_error}</p>
        ) : null}
        {mode === 'move' ? (
          <div className="flex flex-wrap items-center gap-1.5">
            <Input type="datetime-local" className="h-7 w-52 text-xs" value={when} onChange={(e) => setWhen(e.target.value)} />
            <Button size="sm" variant="primary" onClick={async () => { await onAct(url, { action: 'reschedule', at: new Date(when).toISOString() }, `Moved to ${fmtWhen(new Date(when).toISOString())}.`); setMode('view'); }}>Move</Button>
            <Button size="sm" variant="ghost" onClick={() => setMode('view')}>Cancel</Button>
          </div>
        ) : null}
        {editable && mode === 'view' ? (
          <div className="flex gap-0.5 rounded-md bg-white transition-opacity lg:absolute lg:right-2 lg:top-2 lg:border lg:border-zinc-200 lg:opacity-0 lg:shadow-sm lg:group-hover:opacity-100 lg:focus-within:opacity-100 dark:bg-zinc-900 dark:lg:border-zinc-700">
            <Button size="sm" variant="ghost" onClick={() => setMode('edit')}><Pencil className="h-3 w-3" /> Edit</Button>
            <Button size="sm" variant="ghost" onClick={() => setMode('move')}>Move</Button>
            <Button size="sm" variant="ghost" onClick={() => onAct(url, { action: 'send_now' }, 'Sending within a minute.')}>Send now</Button>
            <Button size="sm" variant="ghost" onClick={() => onAct(url, { action: 'cancel' }, 'Removed.')}>Remove</Button>
          </div>
        ) : null}
      </div>
    </article>
  );
}
