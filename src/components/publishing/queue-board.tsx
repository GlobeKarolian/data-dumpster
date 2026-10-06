'use client';

import * as React from 'react';
import { AlertTriangle, ExternalLink, RotateCcw, Sparkles, X, Zap } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input, Textarea } from '@/components/ui/input';
import { PlatformIcon } from '@/components/ui/platform-icon';
import { cn } from '@/lib/utils';
import { chargedLength, TEXT_LIMITS } from '@/lib/publishing/platforms';
import { api, dayKey, dayLabel, fmtTime, fmtWhen, toLocalInput, STATUS_LABEL, STATUS_TONE, type Delivery, type Post, type Target } from './api';
import { accountName, friendlyReason, PostBody, shortUrl } from './bits';
import { usePublish } from './shell';

/**
 * The desk's home screen, laid out the way SocialFlow trained social editors to
 * read it: accounts on the left, what is coming up in the middle, what already
 * went out on the right. Anything waiting on a human (approval, held, failed)
 * sits at the top of the middle column so it cannot be missed.
 */


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

  const inView = (d: Delivery) => !account || d.target_id === account;
  const labelOk = (p: Post) => !label || (p.options?.labels ?? []).includes(label);
  const all = (posts ?? []).filter(labelOk);

  // A newsroom thinks in stories: one card per story, with each account's send inside it.
  const upcoming = all
    .map((p) => ({ p, rows: p.deliveries.filter((d) => inView(d) && (d.status === 'queued' || d.status === 'sending')) }))
    .filter((x) => x.p.status === 'approved' && x.rows.length)
    .map((x) => ({ ...x, rows: [...x.rows].sort((a, b) => (a.scheduled_for ?? '').localeCompare(b.scheduled_for ?? '')) }))
    .sort((a, b) => (a.rows[0].scheduled_for ?? '').localeCompare(b.rows[0].scheduled_for ?? ''));
  const sent = all
    .map((p) => ({ p, rows: p.deliveries.filter((d) => inView(d) && d.status === 'sent') }))
    .filter((x) => x.rows.length)
    .map((x) => ({ ...x, rows: [...x.rows].sort((a, b) => (b.sent_at ?? '').localeCompare(a.sent_at ?? '')) }))
    .sort((a, b) => (b.rows[0].sent_at ?? '').localeCompare(a.rows[0].sent_at ?? ''));
  const attention = all
    .map((p) => ({ p, rows: p.deliveries.filter((d) => inView(d) && (d.status === 'failed' || d.status === 'unschedulable')) }))
    .filter((x) => x.rows.length);
  const waiting = all.filter((p) => (p.status === 'pending_approval' || p.status === 'draft') && p.deliveries.some(inView));
  const labels = [...new Set((posts ?? []).flatMap((p) => p.options?.labels ?? []))].sort();

  const counts = new Map<string, number>();
  for (const p of posts ?? []) for (const d of p.deliveries) if (d.status === 'queued') counts.set(d.target_id, (counts.get(d.target_id) ?? 0) + 1);

  const act = async (url: string, json: unknown, ok: string) => {
    try { await api(url, { method: 'PATCH', json }); toast(ok); refresh(); }
    catch (e) { toast((e as Error).message); }
  };
  const recycle = (p: Post) => openComposer({
    targetIds: p.deliveries.map((d) => d.target_id),
    copy: p.base_copy, link: p.link_url ?? '', linkTitle: p.link_title ?? '', media: p.media_urls, labels: p.options?.labels,
  });

  const byDay = new Map<string, typeof upcoming>();
  for (const x of upcoming) {
    const k = dayKey(x.rows[0].scheduled_for!);
    byDay.set(k, [...(byDay.get(k) ?? []), x]);
  }

  return (
    <div className="grid gap-4 lg:grid-cols-[210px_minmax(0,1fr)_minmax(0,0.8fr)]">
      <AccountRail targets={targets} counts={counts} account={account} onAccount={setAccount}
        labels={labels} label={label} onLabel={setLabel} />

      <section className="min-w-0 space-y-4">
        {error ? <p className="text-sm text-red-600">{error}</p> : null}

        {waiting.length ? (
          <Column title="Waiting on you" count={waiting.length} tone="amber">
            {waiting.map((p) => (
              <StoryCard key={p.id} p={p} rows={p.deliveries.filter(inView)} canApprove={canApprove} onAct={act}
                header={<Badge tone={p.status === 'draft' ? 'outline' : 'warning'}>{p.status === 'draft' ? 'Held' : `Needs approval · ${p.created_by_email?.replace(/^rss:/, 'Autopilot: ')}`}</Badge>}
                footer={
                  <div className="flex gap-1.5">
                    {canApprove ? (
                      <Button size="sm" variant="primary" onClick={() => act(`/api/publishing/posts/${p.id}`, { action: 'approve' }, 'Released to the queue.')}>
                        {p.status === 'draft' ? 'Release to queue' : 'Approve'}
                      </Button>
                    ) : null}
                    {canApprove || p.created_by_email === me ? (
                      <Button size="sm" variant="ghost" onClick={() => act(`/api/publishing/posts/${p.id}`, { action: 'cancel' }, 'Discarded.')}>Discard</Button>
                    ) : null}
                  </div>
                } />
            ))}
          </Column>
        ) : null}

        {attention.length ? (
          <Column title="Needs attention" count={attention.length} tone="red">
            {attention.map(({ p, rows }) => <StoryCard key={p.id} p={p} rows={rows} canApprove={canApprove} onAct={act} />)}
          </Column>
        ) : null}

        <Column title="Up next" count={upcoming.length} note={upcoming.length ? `${upcoming.reduce((n, x) => n + x.rows.length, 0)} posts` : undefined}>
          {posts === null ? (
            <p className="p-6 text-center text-sm text-zinc-400">Loading…</p>
          ) : !upcoming.length ? (
            <div className="space-y-3 p-10 text-center">
              <p className="text-sm text-zinc-500">Nothing queued{account ? ' for this account' : ''}.</p>
              <Button size="sm" variant="primary" onClick={() => openComposer(account ? { targetIds: [account] } : undefined)}>New post</Button>
            </div>
          ) : [...byDay.entries()].map(([k, list]) => (
            <div key={k}>
              <p className="border-b border-zinc-100 bg-zinc-50 px-3 py-1.5 text-[11px] font-semibold uppercase tracking-wide text-zinc-500 dark:border-zinc-800 dark:bg-zinc-900">
                {dayKey(new Date().toISOString()) === k ? 'Today' : dayLabel(k)}
              </p>
              {list.map(({ p, rows }) => <StoryCard key={p.id} p={p} rows={rows} canApprove={canApprove} onAct={act} />)}
            </div>
          ))}
        </Column>
      </section>

      <section className="min-w-0">
        <Column title="Published" count={sent.length} note="Last two days">
          {!sent.length ? (
            <p className="p-6 text-center text-sm text-zinc-400">Nothing sent yet.</p>
          ) : sent.map(({ p, rows }) => (
            <StoryCard key={p.id} p={p} rows={rows} canApprove={false} onAct={act} compact
              footer={<Button size="sm" variant="ghost" onClick={() => recycle(p)}><RotateCcw className="h-3 w-3" /> Post again</Button>} />
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
                <span className="flex-1 truncate">{accountName(t)}</span>
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

function StoryCard({ p, rows, canApprove, onAct, header, footer, compact }: {
  p: Post; rows: Delivery[]; canApprove: boolean; onAct: (url: string, json: unknown, ok: string) => Promise<void>;
  header?: React.ReactNode; footer?: React.ReactNode; compact?: boolean;
}) {
  const m = modeOf(p);
  const card = p.options?.card;
  const image = card?.image ?? p.media_urls[0] ?? null;
  const headline = p.link_title || card?.title || p.base_copy.split('\n')[0] || p.link_url || '(no text)';
  const showCopy = p.base_copy && p.base_copy.trim() !== headline.trim();
  return (
    <article className="space-y-2.5 p-3">
      {header ? <div>{header}</div> : null}
      <div className="flex gap-3">
        {image ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={image} alt="" className={cn('shrink-0 rounded-md object-cover', compact ? 'h-12 w-12' : 'h-16 w-16')} />
        ) : null}
        <div className="min-w-0 flex-1 space-y-1">
          <h3 className="line-clamp-2 text-[14px] font-semibold leading-snug text-zinc-900 dark:text-zinc-50">
            {p.link_url ? <a href={p.link_url} target="_blank" rel="noreferrer" className="hover:underline">{headline}</a> : headline}
          </h3>
          {showCopy && !compact ? <p className="line-clamp-2 text-[13px] text-zinc-600 dark:text-zinc-400">{p.base_copy}</p> : null}
          <div className="flex flex-wrap items-center gap-1.5 text-[11px] text-zinc-400">
            {p.link_url ? <span>{shortUrl(p.link_url).split('/')[0]}</span> : null}
            <Badge tone={m.tone}>{m.icon}{m.label}</Badge>
            {(p.options?.labels ?? []).filter((l) => l !== 'autopilot').map((l) => <Badge key={l} tone="neutral">{l}</Badge>)}
          </div>
        </div>
      </div>
      <ul className="divide-y divide-zinc-100 rounded-md border border-zinc-100 dark:divide-zinc-800 dark:border-zinc-800">
        {rows.map((d) => <DeliveryLine key={d.id} d={d} canApprove={canApprove} onAct={onAct} />)}
      </ul>
      {footer}
    </article>
  );
}

function DeliveryLine({ d, canApprove, onAct }: {
  d: Delivery; canApprove: boolean; onAct: (url: string, json: unknown, ok: string) => Promise<void>;
}) {
  const [mode, setMode] = React.useState<'closed' | 'open' | 'edit' | 'move'>('closed');
  const [text, setText] = React.useState(d.final_text);
  const [when, setWhen] = React.useState(() => toLocalInput(d.scheduled_for ? new Date(d.scheduled_for) : new Date()));
  const len = chargedLength(d.platform, text);
  const limit = TEXT_LIMITS[d.platform];
  const editable = canApprove && ['queued', 'failed', 'unschedulable'].includes(d.status);
  const url = `/api/publishing/deliveries/${d.id}`;
  const time = d.sent_at ?? d.scheduled_for;
  const reason = d.status === 'queued' ? friendlyReason(d.slot_reason) : null;

  return (
    <li className="text-[12px]">
      <div className="flex items-center gap-2 px-2.5 py-1.5">
        <button type="button" onClick={() => setMode(mode === 'closed' ? 'open' : 'closed')} aria-expanded={mode !== 'closed'}
          className="flex min-w-0 flex-1 items-center gap-2 text-left">
          <PlatformIcon platform={d.platform} />
          <span className="w-24 shrink-0 truncate font-medium text-zinc-800 dark:text-zinc-200">{accountName(d)}</span>
          <span className="pb-num w-16 shrink-0 font-semibold text-zinc-900 dark:text-zinc-100">{time ? fmtTime(time) : '—'}</span>
          {d.status !== 'queued' ? <Badge tone={STATUS_TONE[d.status]}>{STATUS_LABEL[d.status]}</Badge> : null}
          {d.provider === 'mock' && d.status === 'sent' ? <Badge tone="outline">test</Badge> : null}
          {reason ? <span className="hidden truncate text-zinc-400 sm:inline">{reason}</span> : null}
        </button>
        {d.post_url ? (
          <a href={d.post_url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-0.5 text-accent-700 hover:underline dark:text-accent-400">
            View <ExternalLink className="h-3 w-3" />
          </a>
        ) : null}
        {editable && mode !== 'edit' && mode !== 'move' ? (
          <span className="flex shrink-0 gap-0.5">
            <button type="button" className="rounded px-1.5 py-0.5 text-zinc-500 hover:bg-zinc-100 hover:text-zinc-900 dark:hover:bg-zinc-800" onClick={() => setMode('edit')}>Edit</button>
            <button type="button" className="rounded px-1.5 py-0.5 text-zinc-500 hover:bg-zinc-100 hover:text-zinc-900 dark:hover:bg-zinc-800" onClick={() => setMode('move')}>Move</button>
            <button type="button" className="rounded px-1.5 py-0.5 text-zinc-500 hover:bg-zinc-100 hover:text-zinc-900 dark:hover:bg-zinc-800" onClick={() => onAct(url, { action: 'send_now' }, 'Sending within a minute.')}>Send now</button>
            <button type="button" aria-label="Remove" className="rounded px-1.5 py-0.5 text-zinc-400 hover:bg-red-50 hover:text-red-700 dark:hover:bg-red-950/40" onClick={() => onAct(url, { action: 'cancel' }, 'Removed.')}><X className="h-3 w-3" /></button>
          </span>
        ) : null}
      </div>
      {d.last_error ? (
        <p className="flex items-start gap-1 px-2.5 pb-1.5 text-[11px] text-red-600 dark:text-red-400"><AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" />{d.last_error}</p>
      ) : null}
      {mode === 'open' ? (
        <div className="bg-zinc-50 px-2.5 py-2 dark:bg-zinc-900/60">
          <PostBody text={d.final_text} className="text-[13px] text-zinc-800 dark:text-zinc-200" />
          {d.link_url && d.link_mode === 'card' ? (
            <p className="mt-1 text-[11px] text-zinc-400">Link card: {shortUrl(d.link_url)}</p>
          ) : null}
        </div>
      ) : null}
      {mode === 'edit' ? (
        <div className="space-y-1.5 bg-zinc-50 px-2.5 py-2 dark:bg-zinc-900/60">
          <Textarea rows={4} value={text} onChange={(e) => setText(e.target.value)} className="text-[13px]" autoFocus />
          <div className="flex items-center gap-1.5">
            <Button size="sm" variant="primary" disabled={len > limit}
              onClick={async () => { await onAct(url, { action: 'edit', text }, 'Saved.'); setMode('closed'); }}>Save</Button>
            <Button size="sm" variant="ghost" onClick={() => { setText(d.final_text); setMode('closed'); }}>Cancel</Button>
            <span className={cn('pb-num ml-auto text-[11px]', len > limit ? 'text-red-600' : 'text-zinc-400')}>{len}/{limit}</span>
          </div>
        </div>
      ) : null}
      {mode === 'move' ? (
        <div className="flex flex-wrap items-center gap-1.5 bg-zinc-50 px-2.5 py-2 dark:bg-zinc-900/60">
          <Input type="datetime-local" className="h-7 w-52 text-xs" value={when} onChange={(e) => setWhen(e.target.value)} />
          <Button size="sm" variant="primary" onClick={async () => { await onAct(url, { action: 'reschedule', at: new Date(when).toISOString() }, `Moved to ${fmtWhen(new Date(when).toISOString())}.`); setMode('closed'); }}>Move</Button>
          <Button size="sm" variant="ghost" onClick={() => setMode('closed')}>Cancel</Button>
        </div>
      ) : null}
    </li>
  );
}
