'use client';

import * as React from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { ArrowLeft, FlaskConical, OctagonPause, Play, Plus } from 'lucide-react';
import { cn } from '@/lib/utils';
import { DumpsterMark } from '@/components/shell/logo';
import { Button } from '@/components/ui/button';
import { api, type Target } from './api';
import { Composer, type ComposerPrefill } from './composer';

/**
 * Publishing gets its own workspace, separate from the analytics app: a social
 * desk lives in this screen all shift, so it gets the whole width, a top bar
 * instead of the analytics sidebar, and the two controls a desk reaches for
 * under pressure (New post, Pause everything) always in the same place.
 */

const TABS = [
  { href: '/publish', label: 'Queue' },
  { href: '/publish/calendar', label: 'Calendar' },
  { href: '/publish/autopilot', label: 'Autopilot' },
  { href: '/publish/accounts', label: 'Accounts' },
];

interface PublishCtx {
  live: boolean;
  canApprove: boolean;
  me: string | null;
  paused: boolean;
  targets: Target[];
  /** Bumps after any change, so pages refetch. */
  version: number;
  refresh: () => void;
  openComposer: (prefill?: ComposerPrefill) => void;
  toast: (message: string) => void;
}

const Ctx = React.createContext<PublishCtx | null>(null);

export function usePublish(): PublishCtx {
  const v = React.useContext(Ctx);
  if (!v) throw new Error('usePublish outside PublishShell');
  return v;
}

export function PublishShell({ live, canApprove, me, children }: {
  live: boolean; canApprove: boolean; me: string | null; children: React.ReactNode;
}) {
  const pathname = usePathname();
  const [targets, setTargets] = React.useState<Target[]>([]);
  const [paused, setPausedState] = React.useState(false);
  const [version, setVersion] = React.useState(0);
  const [composer, setComposer] = React.useState<{ prefill: ComposerPrefill | null; key: number } | null>(null);
  const [toastMsg, setToastMsg] = React.useState<string | null>(null);

  const refresh = React.useCallback(() => setVersion((v) => v + 1), []);
  const toast = React.useCallback((m: string) => {
    setToastMsg(m);
    setTimeout(() => setToastMsg((cur) => (cur === m ? null : cur)), 4000);
  }, []);

  React.useEffect(() => {
    let cancelled = false;
    void Promise.all([
      api<{ targets: Target[] }>('/api/publishing/targets'),
      api<{ paused: boolean }>('/api/publishing/pause'),
    ]).then(([t, p]) => {
      if (cancelled) return;
      setTargets(t.targets);
      setPausedState(p.paused);
    }).catch(() => { /* pages show their own errors */ });
    return () => { cancelled = true; };
  }, [version]);

  // N opens a new post, the way most desk tools do.
  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement;
      if (e.key === 'n' && !e.metaKey && !e.ctrlKey && !['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName) && !el.isContentEditable) {
        e.preventDefault();
        setComposer({ prefill: null, key: Date.now() });
      }
      if (e.key === 'Escape') setComposer(null);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const togglePause = async () => {
    try {
      const r = await api<{ paused: boolean; respaced?: number; expired?: number }>('/api/publishing/pause', { method: 'PUT', json: { paused: !paused } });
      setPausedState(r.paused);
      toast(r.paused ? 'Publishing paused. Nothing will send.' : `Resumed. ${r.respaced ?? 0} overdue posts re-spaced${r.expired ? `, ${r.expired} expired` : ''}.`);
      refresh();
    } catch (e) {
      toast((e as Error).message);
    }
  };

  const value: PublishCtx = {
    live, canApprove, me, paused, targets, version, refresh, toast,
    openComposer: (prefill) => setComposer({ prefill: prefill ?? null, key: Date.now() }),
  };

  return (
    <Ctx.Provider value={value}>
      <div className="flex min-h-dvh flex-col bg-zinc-50 dark:bg-zinc-950">
        <header className="sticky top-0 z-30 border-b border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-950">
          <div className="flex h-14 items-center gap-3 px-4">
            <Link href="/cross-channel" className="flex items-center gap-2" title="Back to analytics">
              <span className="grid h-7 w-7 place-items-center rounded bg-accent-600 text-white"><DumpsterMark className="h-4 w-4" /></span>
              <span className="leading-tight">
                <span className="block text-[9px] font-semibold uppercase tracking-[0.16em] text-zinc-400">Data Dumpster</span>
                <span className="block text-sm font-semibold tracking-tight">Publish</span>
              </span>
            </Link>
            <nav className="ml-4 hidden items-center gap-1 md:flex" aria-label="Publishing">
              {TABS.map((t) => {
                const active = t.href === '/publish' ? pathname === '/publish' : pathname.startsWith(t.href);
                return (
                  <Link key={t.href} href={t.href} aria-current={active ? 'page' : undefined}
                    className={cn('rounded-md px-3 py-1.5 text-[13px] font-medium transition-colors',
                      active ? 'bg-zinc-100 text-zinc-900 dark:bg-zinc-800 dark:text-zinc-50' : 'text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100')}>
                    {t.label}
                  </Link>
                );
              })}
            </nav>
            <div className="ml-auto flex items-center gap-2">
              {!live ? (
                <span className="hidden items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-medium text-amber-800 sm:inline-flex dark:bg-amber-950/60 dark:text-amber-300"
                  title="Nothing reaches a real account until PUBLISHING_LIVE=true">
                  <FlaskConical className="h-3 w-3" /> Test mode
                </span>
              ) : null}
              <Button size="sm" variant={paused ? 'primary' : 'danger'} onClick={togglePause}
                disabled={paused && !canApprove} title={paused ? 'Resume publishing' : 'Stop every scheduled and automated post'}>
                {paused ? <Play className="h-3.5 w-3.5" /> : <OctagonPause className="h-3.5 w-3.5" />}
                {paused ? 'Resume' : 'Pause all'}
              </Button>
              <Button size="sm" variant="primary" onClick={() => value.openComposer()}>
                <Plus className="h-3.5 w-3.5" /> New post
              </Button>
            </div>
          </div>
          <nav className="flex gap-1 overflow-x-auto px-3 pb-2 md:hidden" aria-label="Publishing">
            {TABS.map((t) => (
              <Link key={t.href} href={t.href} className={cn('shrink-0 rounded-md px-2.5 py-1 text-xs',
                (t.href === '/publish' ? pathname === '/publish' : pathname.startsWith(t.href)) ? 'bg-zinc-100 font-medium dark:bg-zinc-800' : 'text-zinc-500')}>
                {t.label}
              </Link>
            ))}
          </nav>
          {paused ? (
            <div className="flex items-center gap-2 bg-red-600 px-4 py-1.5 text-xs font-medium text-white">
              <OctagonPause className="h-3.5 w-3.5" />
              Publishing is paused. Nothing sends, including Autopilot. New stories still queue.
              {canApprove ? <button type="button" onClick={togglePause} className="ml-auto underline">Resume</button> : null}
            </div>
          ) : null}
        </header>

        <main className="mx-auto w-full max-w-[1500px] flex-1 p-4">{children}</main>

        <Link href="/cross-channel" className="mx-auto mb-4 inline-flex items-center gap-1 text-[11px] text-zinc-400 hover:text-zinc-600">
          <ArrowLeft className="h-3 w-3" /> Back to analytics
        </Link>
      </div>

      {composer ? (
        <div className="fixed inset-0 z-50 flex justify-end">
          <button type="button" aria-label="Close composer" className="absolute inset-0 bg-black/30" onClick={() => setComposer(null)} />
          <div role="dialog" aria-modal="true" aria-label="New post"
            className="relative h-full w-full max-w-[1100px] bg-white shadow-2xl dark:bg-zinc-950">
            <Composer key={composer.key} targets={targets} canApprove={canApprove} prefill={composer.prefill}
              onClose={() => setComposer(null)}
              onDone={(m) => { setComposer(null); toast(m); refresh(); }} />
          </div>
        </div>
      ) : null}

      {toastMsg ? (
        <div role="status" className="fixed bottom-4 left-1/2 z-50 -translate-x-1/2 rounded-md bg-zinc-900 px-4 py-2 text-sm text-white shadow-lg dark:bg-zinc-100 dark:text-zinc-900">
          {toastMsg}
        </div>
      ) : null}
    </Ctx.Provider>
  );
}
