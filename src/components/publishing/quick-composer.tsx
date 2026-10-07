'use client';

import * as React from 'react';
import Link from 'next/link';
import { AlertTriangle, ImageOff, Link2, Sparkles, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input, Textarea } from '@/components/ui/input';
import { PlatformIcon } from '@/components/ui/platform-icon';
import { cn } from '@/lib/utils';
import { PUBLISH_PLATFORM_LABELS } from '@/lib/publishing/platforms';
import { api, fmtTime, toLocalInput, type Plan, type Target } from './api';
import { accountName, PostMock, shortUrl } from './bits';

/**
 * The whole posting flow in one box at the top of the Posts screen.
 *
 * It starts as a single field, "Paste a story link", because that is how a
 * desk starts: from a story. Pasting fills the headline, image and the accounts
 * used last time; the editor only touches what needs changing. Timing is a
 * plain-language choice, and the box answers with the actual times each
 * account will post before anything is scheduled.
 */

export interface ComposerPrefill {
  targetIds?: string[];
  copy?: string;
  link?: string;
  media?: string[];
}

type When = 'now' | 'soon' | 'today' | 'tonight' | 'tomorrow' | 'custom';

const WHEN: { id: When; label: string }[] = [
  { id: 'now', label: 'Post now' },
  { id: 'soon', label: 'Best time, next 2 hours' },
  { id: 'today', label: 'Best time today' },
  { id: 'tonight', label: 'Best time tonight' },
  { id: 'tomorrow', label: 'Best time tomorrow' },
  { id: 'custom', label: 'Pick a time' },
];

function at(dayOffset: number, hour: number): Date {
  const d = new Date();
  d.setDate(d.getDate() + dayOffset);
  d.setHours(hour, 0, 0, 0);
  return d;
}

function timingFor(when: When, custom: string) {
  const now = new Date();
  const win = (s: Date, e: Date) => {
    const start = s < now ? now : s;
    const end = e.getTime() - start.getTime() < 30 * 60_000 ? new Date(start.getTime() + 2 * 3600_000) : e;
    return { mode: 'window' as const, start: start.toISOString(), end: end.toISOString(), priority: 'must' as const };
  };
  switch (when) {
    case 'now': return { mode: 'exact' as const, at: now.toISOString() };
    case 'soon': return win(now, new Date(now.getTime() + 2 * 3600_000));
    case 'today': return win(now, at(0, 23));
    case 'tonight': return win(at(0, 17), at(0, 23));
    case 'tomorrow': return win(at(1, 7), at(1, 22));
    case 'custom': return { mode: 'exact' as const, at: new Date(custom).toISOString() };
  }
}

const LAST_ACCOUNTS = 'publish.lastAccounts';

interface DraftResponse {
  article: { title: string; words: number; source: 'jsonld' | 'arc' | 'paragraphs' | 'summary' };
  drafts: { targetId: string; text: string; warnings: string[] }[];
  model: string;
  costUsd: number;
}

function dayWord(iso: string): string {
  const k = (d: Date) => d.toLocaleDateString('en-CA', { timeZone: 'America/New_York' });
  const t = new Date(iso);
  if (k(t) === k(new Date())) return 'Today';
  if (k(t) === k(new Date(Date.now() + 86400_000))) return 'Tomorrow';
  return t.toLocaleDateString('en-US', { timeZone: 'America/New_York', weekday: 'short', month: 'short', day: 'numeric' });
}

export function QuickComposer({ targets, canApprove, prefill, onPosted, focusSignal }: {
  targets: Target[];
  canApprove: boolean;
  prefill: ComposerPrefill | null;
  onPosted: (message: string) => void;
  /** Bumps when the header's New post button is pressed. */
  focusSignal: number;
}) {
  const active = React.useMemo(() => targets.filter((t) => t.active), [targets]);
  const [open, setOpen] = React.useState(false);
  const [link, setLink] = React.useState('');
  const [card, setCard] = React.useState<{ title: string; description: string; image: string | null } | null>(null);
  const [loadingCard, setLoadingCard] = React.useState(false);
  const [copy, setCopy] = React.useState('');
  const [image, setImage] = React.useState<string | null>(null);
  const [selected, setSelected] = React.useState<string[]>([]);
  const [overrides, setOverrides] = React.useState<Record<string, string>>({});
  const [customize, setCustomize] = React.useState(false);
  const [showPreview, setShowPreview] = React.useState(false);
  const [when, setWhen] = React.useState<When>('today');
  const [custom, setCustom] = React.useState(() => toLocalInput(new Date(Date.now() + 60 * 60_000)));
  const [plans, setPlans] = React.useState<Plan[]>([]);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [drafting, setDrafting] = React.useState(false);
  const [drafted, setDrafted] = React.useState<{ model: string; words: number; thin: boolean } | null>(null);
  const [flags, setFlags] = React.useState<Record<string, string[]>>({});
  const draftedFor = React.useRef('');
  const linkRef = React.useRef<HTMLInputElement>(null);

  // Start from the accounts used last time.
  React.useEffect(() => {
    if (!active.length || selected.length) return;
    let saved: string[] = [];
    try { saved = JSON.parse(localStorage.getItem(LAST_ACCOUNTS) ?? '[]'); } catch { /* private mode */ }
    const ids = saved.filter((id) => active.some((t) => t.id === id));
    if (ids.length) void Promise.resolve().then(() => setSelected(ids));
  }, [active, selected.length]);

  // Header "New post" and recycled posts land here.
  React.useEffect(() => {
    if (!focusSignal) return;
    void Promise.resolve().then(() => {
      setOpen(true);
      if (prefill) {
        if (prefill.link) setLink(prefill.link);
        if (prefill.copy) setCopy(prefill.copy);
        if (prefill.media?.[0]) setImage(prefill.media[0]);
        if (prefill.targetIds?.length) setSelected(prefill.targetIds);
      }
      linkRef.current?.focus();
      linkRef.current?.scrollIntoView({ block: 'center', behavior: 'smooth' });
    });
  }, [focusSignal, prefill]);

  // Paste a link: fetch headline and image, fill what is empty.
  const cardFor = React.useRef('');
  React.useEffect(() => {
    const url = link.trim();
    if (!/^https?:\/\/\S+\.\S+/.test(url) || url === cardFor.current) return;
    const handle = setTimeout(async () => {
      cardFor.current = url;
      // Drafts belong to one story; a new link starts clean.
      if (draftedFor.current && draftedFor.current !== url) {
        draftedFor.current = '';
        setOverrides({}); setFlags({}); setDrafted(null); setCustomize(false);
      }
      setOpen(true);
      setLoadingCard(true);
      try {
        const r = await api<{ card: { title: string; description: string; image: string | null } | null }>(`/api/publishing/card?url=${encodeURIComponent(url)}`);
        setCard(r.card);
        if (r.card) {
          setCopy((c) => (c.trim() ? c : r.card!.title));
          if (r.card.image?.startsWith('https://')) setImage((m) => m ?? r.card!.image);
        }
      } catch {
        setCard(null);
      } finally {
        setLoadingCard(false);
      }
    }, 300);
    return () => clearTimeout(handle);
  }, [link]);

  const body = React.useCallback((submit: 'schedule' | 'approval' | 'draft') => ({
    targetIds: selected,
    baseCopy: copy,
    copyByTarget: Object.fromEntries(Object.entries(overrides).filter(([id, v]) => selected.includes(id) && v.trim())),
    linkUrl: link.trim() || null,
    linkTitle: null,
    mediaUrls: image ? [image] : [],
    instagramCollaborators: [],
    labels: [],
    timing: timingFor(when, custom),
    notes: null,
    submit,
  }), [selected, copy, overrides, link, image, when, custom]);

  // Ask the server what each account would actually do: text, length, time.
  React.useEffect(() => {
    if (!open || !selected.length) return;
    const handle = setTimeout(async () => {
      try {
        const r = await api<{ plans: Plan[] }>('/api/publishing/preview', { method: 'POST', json: body('schedule') });
        setPlans(r.plans);
        setError(null);
      } catch (e) {
        setError((e as Error).message);
      }
    }, 400);
    return () => clearTimeout(handle);
  }, [open, body, selected.length]);

  const reset = () => {
    setOpen(false); setLink(''); setCard(null); setCopy(''); setImage(null); setOverrides({});
    setCustomize(false); setShowPreview(false); setPlans([]); setError(null); cardFor.current = '';
    setDrafted(null); setFlags({}); draftedFor.current = '';
  };

  // Read the story and write a post for each chosen account. Editors review before anything is scheduled.
  const draftPosts = async () => {
    const url = link.trim();
    setDrafting(true);
    setError(null);
    try {
      const r = await api<DraftResponse>('/api/publishing/draft', { method: 'POST', json: { url, targetIds: selected } });
      setOverrides((o) => ({ ...o, ...Object.fromEntries(r.drafts.map((d) => [d.targetId, d.text])) }));
      setFlags(Object.fromEntries(r.drafts.map((d) => [d.targetId, d.warnings])));
      setDrafted({ model: r.model, words: r.article.words, thin: r.article.source === 'summary' });
      setCustomize(true);
      draftedFor.current = url;
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setDrafting(false);
    }
  };

  const toggle = (ids: string[], on: boolean) => {
    const next = on ? [...new Set([...selected, ...ids])] : selected.filter((x) => !ids.includes(x));
    setSelected(next);
    try { localStorage.setItem(LAST_ACCOUNTS, JSON.stringify(next)); } catch { /* private mode */ }
  };

  const submit = async (kind: 'schedule' | 'approval' | 'draft') => {
    setBusy(true);
    setError(null);
    try {
      const r = await api<{ status: string; plans: Plan[] }>('/api/publishing/posts', { method: 'POST', json: body(kind) });
      const times = r.plans.filter((p) => p.slot).map((p) => `${PUBLISH_PLATFORM_LABELS[p.platform]} ${fmtTime(p.slot!.at)}`).join(', ');
      onPosted(r.status === 'approved' ? (when === 'now' ? 'Posting now.' : `Scheduled: ${times}`) : r.status === 'draft' ? 'Saved as a draft.' : 'Sent for review.');
      reset();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const shown = selected.length ? plans.filter((p) => selected.includes(p.targetId)) : [];
  const problems = shown.flatMap((p) => p.problems.map((x) => `${PUBLISH_PLATFORM_LABELS[p.platform]}: ${x}`))
    .concat(shown.filter((p) => !p.slot && when !== 'now').map((p) => `${PUBLISH_PLATFORM_LABELS[p.platform]}: ${p.slotError ?? 'no time available'}`));
  const blocked = !selected.length || !copy.trim() && !link.trim() || problems.length > 0;
  const brands = [...new Set(active.map((t) => t.brand))];
  const primary = !canApprove ? 'Submit for review' : when === 'now' ? 'Post now' : 'Schedule';

  if (!targets.length) {
    return (
      <div className="rounded-xl border border-dashed border-zinc-300 bg-white p-6 text-center text-sm text-zinc-500 dark:border-zinc-700 dark:bg-zinc-900">
        No social accounts are set up yet. Add them in <Link href="/publish/accounts" className="text-accent-700 underline">Settings</Link>.
      </div>
    );
  }

  return (
    <section className={cn('rounded-xl border bg-white shadow-sm transition-shadow dark:bg-zinc-900',
      open ? 'border-zinc-300 shadow-md dark:border-zinc-700' : 'border-zinc-200 dark:border-zinc-800')}>
      {/* The one field everything starts from */}
      <div className="flex items-center gap-3 px-4 py-3">
        <Link2 className="h-5 w-5 shrink-0 text-zinc-400" />
        <input
          ref={linkRef}
          type="url"
          value={link}
          onChange={(e) => setLink(e.target.value)}
          onFocus={() => setOpen(true)}
          placeholder="Paste a story link"
          className="h-10 min-w-0 flex-1 bg-transparent text-[16px] outline-none placeholder:text-zinc-400"
        />
        {open ? (
          <Button size="sm" variant="ghost" onClick={reset} aria-label="Close"><X className="h-4 w-4" /></Button>
        ) : (
          <Button size="sm" variant="ghost" className="hidden sm:inline-flex" onClick={() => setOpen(true)}>Write without a link</Button>
        )}
      </div>

      {open ? (
        <div className="space-y-5 border-t border-zinc-100 px-4 pb-4 pt-4 dark:border-zinc-800">
          {/* Story + words */}
          <div className="flex gap-4">
            <div className="relative shrink-0">
              {image ? (
                <>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={image} alt="" className="h-24 w-24 rounded-lg object-cover sm:h-28 sm:w-36" />
                  <button type="button" onClick={() => setImage(null)} aria-label="Remove image"
                    className="absolute -right-2 -top-2 grid h-6 w-6 place-items-center rounded-full bg-zinc-900 text-white shadow">
                    <X className="h-3.5 w-3.5" />
                  </button>
                </>
              ) : (
                <div className="grid h-24 w-24 place-items-center rounded-lg border border-dashed border-zinc-300 p-1.5 text-center text-[11px] text-zinc-400 sm:h-28 sm:w-36 dark:border-zinc-700">
                  {loadingCard ? 'Loading…' : (
                    <span className="space-y-1">
                      <ImageOff className="mx-auto h-4 w-4" />
                      <input aria-label="Image URL" placeholder="Image URL" className="w-full rounded border border-zinc-200 bg-transparent px-1 py-0.5 text-[11px] outline-none dark:border-zinc-700"
                        onKeyDown={(e) => {
                          const v = (e.target as HTMLInputElement).value.trim();
                          if (e.key === 'Enter' && /^https:\/\//.test(v)) { e.preventDefault(); setImage(v); }
                        }} />
                    </span>
                  )}
                </div>
              )}
            </div>
            <div className="min-w-0 flex-1 space-y-2">
              {link.trim() ? <p className="truncate text-xs text-zinc-400">{loadingCard ? 'Reading the story…' : card ? `From ${shortUrl(link.trim()).split('/')[0]}` : 'Could not read this page; write the post yourself.'}</p> : null}
              {customize ? <p className="text-[11px] font-medium text-zinc-500">Default text, used by any account left blank below</p> : null}
              <Textarea rows={customize ? 2 : 3} value={copy} onChange={(e) => setCopy(e.target.value)}
                placeholder="What should the post say?" className="text-[15px] leading-snug" />
              {/^https?:\/\/\S+\.\S+/.test(link.trim()) ? (
                <div className="flex flex-wrap items-center gap-2">
                  <Button size="sm" variant="secondary" disabled={drafting || loadingCard || !selected.length} onClick={draftPosts}
                    title={selected.length ? undefined : 'Choose accounts below first'}>
                    <Sparkles className="h-3.5 w-3.5 text-violet-600" />
                    {drafting ? 'Reading the story and drafting…' : drafted ? 'Draft again' : 'Draft posts with AI'}
                  </Button>
                  {drafted ? (
                    <span className={cn('text-[11px]', drafted.thin ? 'text-amber-700 dark:text-amber-300' : 'text-zinc-500')}>
                      {drafted.thin
                        ? 'Only the story summary could be read, so these drafts are thin. Check them closely.'
                        : `Drafted from the full story (${drafted.words.toLocaleString()} words) by ${drafted.model}. Read each one before scheduling.`}
                    </span>
                  ) : !selected.length ? <span className="text-[11px] text-zinc-400">Choose accounts below, then draft a post for each.</span> : null}
                </div>
              ) : null}
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px]">
                {shown.filter((p) => p.limit <= 500 || p.length > p.limit).map((p) => (
                  <span key={p.targetId} className={cn('pb-num inline-flex items-center gap-1', p.length > p.limit ? 'font-semibold text-red-600' : 'text-zinc-400')}>
                    <PlatformIcon platform={p.platform} className="h-3 w-3" />{p.length}/{p.limit}
                  </span>
                ))}
                {shown.length ? (
                  <>
                    <button type="button" className="text-accent-700 hover:underline dark:text-accent-400" onClick={() => setCustomize(!customize)}>
                      {customize ? 'Use one caption everywhere' : 'Different text per network'}
                    </button>
                    <button type="button" className="text-accent-700 hover:underline dark:text-accent-400" onClick={() => setShowPreview(!showPreview)}>
                      {showPreview ? 'Hide preview' : 'Preview posts'}
                    </button>
                  </>
                ) : null}
              </div>
            </div>
          </div>

          {customize ? (
            <div className="grid gap-2 sm:grid-cols-2">
              {shown.map((p) => (
                <label key={p.targetId} className="block space-y-1">
                  <span className="flex items-center gap-1.5 text-xs font-medium"><PlatformIcon platform={p.platform} />{p.brand} {PUBLISH_PLATFORM_LABELS[p.platform]}</span>
                  <Textarea rows={drafted ? 5 : 3} className="text-[13px]" placeholder={copy}
                    value={overrides[p.targetId] ?? ''} onChange={(e) => setOverrides({ ...overrides, [p.targetId]: e.target.value })} />
                  {flags[p.targetId]?.length ? (
                    <ul className="space-y-0.5 text-[11px] text-amber-800 dark:text-amber-300">
                      {flags[p.targetId].map((w) => <li key={w} className="flex gap-1"><AlertTriangle className="mt-px h-3 w-3 shrink-0" />{w}</li>)}
                    </ul>
                  ) : null}
                </label>
              ))}
            </div>
          ) : null}

          {/* Where */}
          <div className="space-y-2">
            <p className="text-xs font-semibold uppercase tracking-wide text-zinc-500">Post to</p>
            {brands.map((brand) => {
              const ts = active.filter((t) => t.brand === brand);
              const ids = ts.map((t) => t.id);
              const all = ids.every((id) => selected.includes(id));
              return (
                <div key={brand} className="flex flex-wrap items-center gap-2">
                  <button type="button" onClick={() => toggle(ids, !all)}
                    className="w-28 shrink-0 truncate text-left text-sm font-medium text-zinc-700 hover:text-zinc-950 dark:text-zinc-300">
                    {brand}
                  </button>
                  {ts.map((t) => {
                    const on = selected.includes(t.id);
                    return (
                      <button key={t.id} type="button" aria-pressed={on} onClick={() => toggle([t.id], !on)}
                        title={`${brand} ${accountName(t)}`}
                        className={cn('inline-flex h-9 items-center gap-2 rounded-lg border px-3 text-sm transition',
                          on ? 'border-zinc-900 bg-zinc-900 text-white dark:border-zinc-100 dark:bg-zinc-100 dark:text-zinc-900'
                            : 'border-zinc-200 bg-white text-zinc-500 hover:border-zinc-400 dark:border-zinc-700 dark:bg-zinc-900')}>
                        <PlatformIcon platform={t.platform} className={on ? 'text-white dark:text-zinc-900' : undefined} />
                        {accountName(t)}
                      </button>
                    );
                  })}
                </div>
              );
            })}
          </div>

          {/* When */}
          <div className="space-y-2">
            <p className="text-xs font-semibold uppercase tracking-wide text-zinc-500">When</p>
            <div className="flex flex-wrap gap-2">
              {WHEN.map((w) => (
                <button key={w.id} type="button" aria-pressed={when === w.id} onClick={() => setWhen(w.id)}
                  className={cn('h-9 rounded-lg border px-3 text-sm transition',
                    when === w.id ? 'border-accent-600 bg-accent-600/10 font-medium text-zinc-900 dark:text-zinc-50'
                      : 'border-zinc-200 text-zinc-600 hover:border-zinc-400 dark:border-zinc-700 dark:text-zinc-300')}>
                  {w.label}
                </button>
              ))}
              {when === 'custom' ? (
                <Input type="datetime-local" className="h-9 w-56" value={custom} onChange={(e) => setCustom(e.target.value)} />
              ) : null}
            </div>
            {shown.length && when !== 'now' ? (
              <p className="flex flex-wrap gap-x-4 gap-y-1 text-[13px] text-zinc-600 dark:text-zinc-300">
                {shown.map((p) => (
                  <span key={p.targetId} className="inline-flex items-center gap-1.5">
                    <PlatformIcon platform={p.platform} className="h-3.5 w-3.5" />
                    {p.slot ? <span className="pb-num font-medium">{dayWord(p.slot.at)} {fmtTime(p.slot.at)}</span> : <span className="text-amber-700">no time</span>}
                  </span>
                ))}
              </p>
            ) : null}
            {when !== 'now' && when !== 'custom' ? (
              <p className="text-[11px] text-zinc-400">Each account posts at the hour its followers have engaged most, inside its posting hours and spaced from its other posts.</p>
            ) : null}
          </div>

          {showPreview && shown.length ? (
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {shown.map((p) => (
                <div key={p.targetId} className="rounded-lg border border-zinc-200 p-3 dark:border-zinc-800">
                  <PostMock platform={p.platform} brand={p.brand} text={p.finalText} linkUrl={p.linkUrl} linkMode={p.linkMode} card={card} image={image} />
                </div>
              ))}
            </div>
          ) : null}

          {problems.length ? (
            <ul className="space-y-1 rounded-lg bg-amber-50 p-3 text-[13px] text-amber-900 dark:bg-amber-950/40 dark:text-amber-200">
              {problems.map((x) => <li key={x} className="flex gap-1.5"><AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />{x}</li>)}
            </ul>
          ) : null}
          {error ? <p className="text-sm text-red-600">{error}</p> : null}

          <div className="flex flex-wrap items-center gap-2 border-t border-zinc-100 pt-4 dark:border-zinc-800">
            <Button variant="primary" className="h-10 px-5 text-[15px]" disabled={busy || blocked}
              onClick={() => submit(canApprove ? 'schedule' : 'approval')}>
              {busy ? 'Working…' : primary}
            </Button>
            <Button variant="ghost" disabled={busy || !selected.length} onClick={() => submit('draft')}>Save draft</Button>
            {canApprove ? <Button variant="ghost" disabled={busy || !selected.length} onClick={() => submit('approval')}>Send for review</Button> : null}
            <span className="ml-auto text-xs text-zinc-400">
              {selected.length ? `${selected.length} account${selected.length === 1 ? '' : 's'}` : 'Choose at least one account'}
            </span>
          </div>
        </div>
      ) : null}
    </section>
  );
}
