'use client';

import * as React from 'react';
import { AlertTriangle, Check, Rss } from 'lucide-react';
import { PlatformIcon } from '@/components/ui/platform-icon';
import { cn } from '@/lib/utils';
import { api, dayKey, dayLabel, fmtTime, type Delivery, type Post } from './api';
import { QuickComposer } from './quick-composer';
import { usePublish } from './shell';
import { StoryDrawer, headlineOf, imageOf } from './story-drawer';

/**
 * The Posts screen: write at the top, everything else is one list of stories
 * by day. Tabs answer the three questions a desk asks: what is coming, what
 * already went out, and what needs a person.
 */

type Tab = 'scheduled' | 'posted' | 'review' | 'problems';

function usePosts(version: number) {
  const [posts, setPosts] = React.useState<Post[] | null>(null);
  const [tick, setTick] = React.useState(0);
  React.useEffect(() => {
    let cancelled = false;
    const from = new Date(Date.now() - 3 * 86400_000).toISOString();
    const to = new Date(Date.now() + 21 * 86400_000).toISOString();
    void api<{ posts: Post[] }>(`/api/publishing/posts?from=${from}&to=${to}`)
      .then((r) => { if (!cancelled) setPosts(r.posts); })
      .catch(() => { if (!cancelled) setPosts([]); });
    return () => { cancelled = true; };
  }, [version, tick]);
  React.useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), 30_000);
    return () => clearInterval(id);
  }, []);
  return posts;
}

function relativeDay(k: string): string {
  const off = (n: number) => dayKey(new Date(Date.now() + n * 86400_000).toISOString());
  if (k === off(0)) return 'Today';
  if (k === off(1)) return 'Tomorrow';
  if (k === off(-1)) return 'Yesterday';
  return dayLabel(k);
}

const isPending = (d: Delivery) => d.status === 'queued' || d.status === 'sending';
const isProblem = (d: Delivery) => d.status === 'failed' || d.status === 'unschedulable';

export function PostsBoard() {
  const { targets, loaded, canApprove, version, composer, toast, refresh } = usePublish();
  const posts = usePosts(version);
  const [tab, setTab] = React.useState<Tab>('scheduled');
  const [brand, setBrand] = React.useState('');
  const [openId, setOpenId] = React.useState<string | null>(null);
  const [retrying, setRetrying] = React.useState(false);

  const brands = [...new Set(targets.map((t) => t.brand))];
  const list = (posts ?? []).filter((p) => !brand || p.deliveries.some((d) => d.brand === brand));
  const scheduled = list.filter((p) => p.status === 'approved' && p.deliveries.some(isPending));
  const posted = list.filter((p) => p.deliveries.some((d) => d.status === 'sent'));
  const review = list.filter((p) => p.status === 'pending_approval' || p.status === 'draft');
  const problems = list.filter((p) => p.status === 'approved' && p.deliveries.some(isProblem));

  const retryAll = async () => {
    setRetrying(true);
    let ok = 0, failed = 0;
    for (const p of problems) {
      for (const d of p.deliveries.filter(isProblem)) {
        try { await api(`/api/publishing/deliveries/${d.id}`, { method: 'PATCH', json: { action: 'retry' } }); ok++; } catch { failed++; }
      }
    }
    setRetrying(false);
    toast(failed ? `Rescheduled ${ok}; ${failed} still need a person.` : `Rescheduled ${ok} posts at their next open times.`);
    refresh();
    setTab('scheduled');
  };

  const rows = tab === 'scheduled' ? scheduled : tab === 'posted' ? posted : tab === 'review' ? review : problems;
  const keyTime = (p: Post): string => {
    if (tab === 'posted') return p.deliveries.filter((d) => d.sent_at).map((d) => d.sent_at!).sort().reverse()[0] ?? p.created_at;
    const t = p.deliveries.filter(isPending).map((d) => d.scheduled_for!).sort()[0];
    return t ?? (p.timing.mode === 'window' ? p.timing.start : p.timing.at) ?? p.created_at;
  };
  const sorted = [...rows].sort((a, b) => tab === 'posted' ? keyTime(b).localeCompare(keyTime(a)) : keyTime(a).localeCompare(keyTime(b)));
  const groups = new Map<string, Post[]>();
  for (const p of sorted) {
    const k = dayKey(keyTime(p));
    groups.set(k, [...(groups.get(k) ?? []), p]);
  }
  const open = (posts ?? []).find((p) => p.id === openId) ?? null;

  const tabs: { id: Tab; label: string; count: number; show: boolean; tone?: 'red' | 'amber' }[] = [
    { id: 'scheduled', label: 'Scheduled', count: scheduled.length, show: true },
    { id: 'posted', label: 'Posted', count: posted.length, show: true },
    { id: 'review', label: 'Drafts & review', count: review.length, show: review.length > 0 || tab === 'review', tone: 'amber' },
    { id: 'problems', label: 'Problems', count: problems.length, show: problems.length > 0 || tab === 'problems', tone: 'red' },
  ];

  return (
    <div className="mx-auto max-w-3xl space-y-5">
      {!loaded ? <div className="h-[66px] animate-pulse rounded-xl border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900" /> : <QuickComposer targets={targets} canApprove={canApprove} prefill={composer.prefill} focusSignal={composer.signal}
        onPosted={(m) => { toast(m); refresh(); setTab('scheduled'); }} />}

      {problems.length && tab !== 'problems' ? (
        <button type="button" onClick={() => setTab('problems')}
          className="flex w-full items-center gap-2 rounded-lg border border-red-200 bg-red-50 px-4 py-2.5 text-left text-sm text-red-800 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300">
          <AlertTriangle className="h-4 w-4" />
          {problems.length} {problems.length === 1 ? 'post' : 'posts'} could not go out. Review
        </button>
      ) : null}

      <div className="flex flex-wrap items-center gap-2 border-b border-zinc-200 dark:border-zinc-800">
        {tabs.filter((t) => t.show).map((t) => (
          <button key={t.id} type="button" onClick={() => setTab(t.id)} aria-current={tab === t.id ? 'page' : undefined}
            className={cn('-mb-px border-b-2 px-3 py-2 text-sm font-medium transition-colors',
              tab === t.id ? 'border-zinc-900 text-zinc-900 dark:border-zinc-100 dark:text-zinc-50' : 'border-transparent text-zinc-500 hover:text-zinc-800')}>
            {t.label}
            <span className={cn('pb-num ml-1.5 rounded-full px-1.5 py-0.5 text-[11px]',
              t.tone === 'red' ? 'bg-red-100 text-red-700' : t.tone === 'amber' ? 'bg-amber-100 text-amber-800' : 'bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300')}>{t.count}</span>
          </button>
        ))}
        {brands.length > 1 ? (
          <select value={brand} onChange={(e) => setBrand(e.target.value)} aria-label="Brand"
            className="mb-1 ml-auto h-8 rounded-md border border-zinc-200 bg-white px-2 text-sm dark:border-zinc-700 dark:bg-zinc-900">
            <option value="">All brands</option>
            {brands.map((b) => <option key={b} value={b}>{b}</option>)}
          </select>
        ) : null}
      </div>

      {tab === 'problems' && problems.length && canApprove ? (
        <div className="flex flex-wrap items-center gap-3 rounded-lg bg-zinc-100 px-4 py-2.5 text-sm dark:bg-zinc-900">
          <span className="flex-1 text-zinc-600 dark:text-zinc-300">These missed their time. Each can go out at its account&apos;s next open time.</span>
          <button type="button" disabled={retrying} onClick={retryAll}
            className="rounded-md bg-zinc-900 px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900">
            {retrying ? 'Finding times…' : 'Find new times for all'}
          </button>
        </div>
      ) : null}

      {posts === null ? (
        <p className="py-10 text-center text-sm text-zinc-400">Loading…</p>
      ) : !sorted.length ? (
        <p className="py-12 text-center text-sm text-zinc-500">
          {tab === 'scheduled' ? 'Nothing scheduled. Paste a story link above to share one.' : tab === 'posted' ? 'Nothing posted in the last three days.' : 'Nothing here.'}
        </p>
      ) : [...groups.entries()].map(([k, ps]) => (
        <section key={k} className="space-y-2">
          <h2 className="text-xs font-semibold uppercase tracking-wide text-zinc-500">{relativeDay(k)}</h2>
          <ul className="divide-y divide-zinc-100 overflow-hidden rounded-xl border border-zinc-200 bg-white dark:divide-zinc-800 dark:border-zinc-800 dark:bg-zinc-900">
            {ps.map((p) => <StoryRow key={p.id} p={p} tab={tab} time={keyTime(p)} onOpen={() => setOpenId(p.id)} />)}
          </ul>
        </section>
      ))}

      {open ? <StoryDrawer post={open} onClose={() => setOpenId(null)} /> : null}
    </div>
  );
}

function StoryRow({ p, tab, time, onOpen }: { p: Post; tab: Tab; time: string; onOpen: () => void }) {
  const img = imageOf(p);
  const visible = p.deliveries.filter((d) => d.status !== 'canceled');
  return (
    <li>
      <button type="button" onClick={onOpen} className="flex w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-zinc-50 dark:hover:bg-zinc-800/50">
        <span className="pb-num w-16 shrink-0 text-sm font-semibold text-zinc-900 dark:text-zinc-100">
          {tab === 'review' ? '' : fmtTime(time)}
        </span>
        {img ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={img} alt="" className="h-12 w-12 shrink-0 rounded-md object-cover" />
        ) : <span className="h-12 w-12 shrink-0 rounded-md bg-zinc-100 dark:bg-zinc-800" />}
        <span className="min-w-0 flex-1">
          <span className="line-clamp-2 text-[14px] font-medium leading-snug text-zinc-900 dark:text-zinc-100">{headlineOf(p)}</span>
          <span className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1">
            {visible.map((d) => (
              <span key={d.id} className={cn('inline-flex items-center gap-1 text-[12px]',
                d.status === 'sent' ? 'text-emerald-700 dark:text-emerald-400' : d.status === 'failed' || d.status === 'unschedulable' ? 'text-red-600' : 'text-zinc-500')}>
                <PlatformIcon platform={d.platform} className="h-3.5 w-3.5" />
                {d.status === 'sent' ? <Check className="h-3 w-3" /> : null}
                <span className="pb-num">{d.status === 'held' ? '' : d.status === 'failed' ? 'failed' : d.status === 'unschedulable' ? 'no time' : fmtTime(d.sent_at ?? d.scheduled_for ?? time)}</span>
              </span>
            ))}
            {p.origin === 'rss' ? <span className="inline-flex items-center gap-1 text-[11px] text-zinc-400"><Rss className="h-3 w-3" />RSS</span> : null}
          </span>
        </span>
        <span className="hidden shrink-0 text-xs text-zinc-400 sm:block">{visible[0]?.brand}</span>
      </button>
    </li>
  );
}
