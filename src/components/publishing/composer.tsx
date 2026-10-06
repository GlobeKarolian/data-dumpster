'use client';

import * as React from 'react';
import { AlertTriangle, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Field, Input, Textarea } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { PlatformIcon } from '@/components/ui/platform-icon';
import { cn } from '@/lib/utils';
import { PUBLISH_PLATFORM_LABELS } from '@/lib/publishing/platforms';
import { api, fmtWhen, toLocalInput, type Plan, type Target } from './api';
import { accountName, friendlyReason, PostMock } from './bits';

/**
 * The four ways to send, named the way SocialFlow's social desks already
 * think about them:
 *  optimize  pick a window; each account chooses its best slot inside it
 *  schedule  an exact time
 *  now       as soon as the dispatcher next runs (within a minute)
 *  hold      save without sending; edit and release later
 */
export type SendMode = 'optimize' | 'schedule' | 'now' | 'hold';

export interface ComposerPrefill {
  targetIds?: string[];
  copy?: string;
  link?: string;
  linkTitle?: string;
  media?: string[];
  labels?: string[];
}

interface Preset { id: string; label: string; range: () => [Date, Date] }

function at(dayOffset: number, hour: number): Date {
  const d = new Date();
  d.setDate(d.getDate() + dayOffset);
  d.setHours(hour, 0, 0, 0);
  return d;
}

const PRESETS: Preset[] = [
  { id: 'soon', label: 'Next 2 hours', range: () => [new Date(), new Date(Date.now() + 2 * 3600_000)] },
  { id: 'today', label: 'Rest of today', range: () => [new Date(), at(0, 23)] },
  { id: 'evening', label: 'Tonight', range: () => [at(0, 17), at(0, 22)] },
  { id: 'tomorrow-am', label: 'Tomorrow AM', range: () => [at(1, 6), at(1, 11)] },
  { id: 'tomorrow', label: 'Tomorrow', range: () => [at(1, 6), at(1, 23)] },
  { id: 'weekend', label: 'Weekend', range: () => {
    const d = new Date(); const toSat = d.getDay() === 6 ? 0 : (6 - d.getDay());
    return [at(toSat, 8), at(toSat + 1, 22)];
  } },
];

const MODES: { id: SendMode; label: string; hint: string }[] = [
  { id: 'optimize', label: 'Optimize', hint: 'Each account posts at its best slot in the window.' },
  { id: 'schedule', label: 'Schedule', hint: 'Every account posts at this exact time.' },
  { id: 'now', label: 'Publish now', hint: 'Goes out within a minute.' },
  { id: 'hold', label: 'Hold', hint: 'Saved, not sent. Release it from the queue later.' },
];

export function Composer({ targets, canApprove, prefill, onDone, onClose }: {
  targets: Target[];
  canApprove: boolean;
  prefill?: ComposerPrefill | null;
  onDone: (message: string) => void;
  onClose: () => void;
}) {
  const active = targets.filter((t) => t.active);
  // Desks post to the same accounts over and over, so start from the last selection.
  const [selected, setSelected] = React.useState<string[]>(() => {
    if (prefill?.targetIds) return prefill.targetIds;
    try {
      const saved = JSON.parse(localStorage.getItem('publish.lastAccounts') ?? '[]') as string[];
      return saved.filter((id) => targets.some((t) => t.id === id && t.active));
    } catch { return []; }
  });
  React.useEffect(() => {
    try { localStorage.setItem('publish.lastAccounts', JSON.stringify(selected)); } catch { /* private mode */ }
  }, [selected]);
  const [copy, setCopy] = React.useState(prefill?.copy ?? '');
  const [overrides, setOverrides] = React.useState<Record<string, string>>({});
  const [link, setLink] = React.useState(prefill?.link ?? '');
  const [linkTitle, setLinkTitle] = React.useState(prefill?.linkTitle ?? '');
  const [media, setMedia] = React.useState((prefill?.media ?? []).join('\n'));
  const [collabs, setCollabs] = React.useState('');
  const [labels, setLabels] = React.useState((prefill?.labels ?? []).join(', '));
  const [mode, setMode] = React.useState<SendMode>('optimize');
  const [priority, setPriority] = React.useState<'must' | 'can'>('must');
  const [preset, setPreset] = React.useState('soon');
  const [start, setStart] = React.useState(() => toLocalInput(new Date()));
  const [end, setEnd] = React.useState(() => toLocalInput(new Date(Date.now() + 2 * 3600_000)));
  const [exact, setExact] = React.useState(() => toLocalInput(new Date(Date.now() + 30 * 60_000)));
  const [rawPlans, setPlans] = React.useState<Plan[]>([]);
  const [card, setCard] = React.useState<{ title: string; description: string; image: string | null } | null>(null);
  const [previewError, setPreviewError] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const brands = React.useMemo(() => {
    const m = new Map<string, Target[]>();
    for (const t of active) m.set(t.brand, [...(m.get(t.brand) ?? []), t]);
    return [...m.entries()];
  }, [active]);

  const choosePreset = (id: string) => {
    setPreset(id);
    const p = PRESETS.find((x) => x.id === id);
    if (p) {
      const [s, e] = p.range();
      setStart(toLocalInput(s));
      setEnd(toLocalInput(e));
    }
  };

  const body = React.useCallback((submit: 'schedule' | 'approval' | 'draft') => ({
    targetIds: selected,
    baseCopy: copy,
    copyByTarget: Object.fromEntries(Object.entries(overrides).filter(([id, v]) => selected.includes(id) && v.trim())),
    linkUrl: link.trim() || null,
    linkTitle: linkTitle.trim() || null,
    mediaUrls: media.split(/\s+/).map((s) => s.trim()).filter(Boolean),
    instagramCollaborators: collabs.split(/[\s,]+/).map((s) => s.trim()).filter(Boolean),
    labels: labels.split(',').map((s) => s.trim()).filter(Boolean).slice(0, 5),
    timing: mode === 'optimize'
      ? { mode: 'window', start: new Date(start).toISOString(), end: new Date(end).toISOString(), priority }
      : { mode: 'exact', at: mode === 'schedule' ? new Date(exact).toISOString() : new Date().toISOString() },
    notes: null,
    submit,
  }), [selected, copy, overrides, link, linkTitle, media, collabs, labels, mode, priority, exact, start, end]);

  // As soon as a story link is pasted: fetch its headline and image, and fill
  // empty fields from them. Editors start from the story, not a blank box.
  const cardFor = React.useRef('');
  React.useEffect(() => {
    const url = link.trim();
    if (!/^https?:\/\/\S+\.\S+/.test(url) || url === cardFor.current) return;
    const handle = setTimeout(async () => {
      cardFor.current = url;
      try {
        const r = await api<{ card: { title: string; description: string; image: string | null } | null }>(`/api/publishing/card?url=${encodeURIComponent(url)}`);
        setCard(r.card);
        if (r.card) {
          setCopy((c) => (c.trim() ? c : r.card!.title));
          if (r.card.image?.startsWith('https://')) setMedia((m) => (m.trim() ? m : r.card!.image!));
        }
      } catch {
        setCard(null);
      }
    }, 400);
    return () => clearTimeout(handle);
  }, [link]);

  // Live dry run: exact text, tagged link and the slot each account would get.
  React.useEffect(() => {
    if (!selected.length) return;
    const handle = setTimeout(async () => {
      try {
        const r = await api<{ plans: Plan[] }>('/api/publishing/preview', { method: 'POST', json: body('schedule') });
        setPlans(r.plans);
        setPreviewError(null);
      } catch (e) {
        setPreviewError((e as Error).message);
      }
    }, 500);
    return () => clearTimeout(handle);
  }, [body, selected.length]);

  const submit = async (kind: 'schedule' | 'approval' | 'draft') => {
    setBusy(true);
    setError(null);
    try {
      const r = await api<{ status: string }>('/api/publishing/posts', { method: 'POST', json: body(kind) });
      onDone(r.status === 'approved' ? (mode === 'now' ? 'Sending within a minute.' : 'Queued.') : r.status === 'draft' ? 'Held. Release it from the queue.' : 'Sent for approval.');
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const plans = selected.length ? rawPlans : [];
  const hasIg = selected.some((id) => targets.find((t) => t.id === id)?.platform === 'instagram');
  const blocking = plans.some((p) => p.problems.length > 0 || (!p.slot && !(mode === 'optimize' && priority === 'can')));
  const primaryLabel = mode === 'hold' ? 'Hold' : !canApprove ? 'Submit for approval' : mode === 'now' ? 'Publish now' : mode === 'schedule' ? 'Schedule' : 'Add to queue';
  const mediaList = media.split(/\s+/).map((x) => x.trim()).filter(Boolean);
  const [showMore, setShowMore] = React.useState(false);
  const [openVersion, setOpenVersion] = React.useState<string | null>(null);
  const shownCard = card ? { ...card, title: linkTitle || card.title } : null;

  return (
    <div className="flex h-full flex-col">
      <header className="flex h-14 shrink-0 items-center justify-between border-b border-zinc-200 px-5 dark:border-zinc-800">
        <h2 className="text-sm font-semibold">New post</h2>
        <Button size="icon" variant="ghost" aria-label="Close" onClick={onClose}><X className="h-4 w-4" /></Button>
      </header>

      {!targets.length ? (
        <p className="p-10 text-center text-sm text-zinc-500">No accounts yet. An admin can add them under Accounts.</p>
      ) : (
        <div className="grid min-h-0 flex-1 overflow-y-auto lg:grid-cols-[minmax(0,1.05fr)_minmax(0,1fr)] lg:overflow-hidden">
          {/* Left: the story, the words, the accounts */}
          <div className="space-y-5 p-5 lg:overflow-y-auto">
            <div className="space-y-2">
              <label htmlFor="pub-link" className="text-xs font-medium text-zinc-700 dark:text-zinc-300">Story link</label>
              <Input id="pub-link" type="url" autoFocus className="h-11 text-[15px]" placeholder="Paste a story URL"
                value={link} onChange={(e) => setLink(e.target.value)} />
              {shownCard ? (
                <div className="flex gap-3 rounded-lg border border-zinc-200 p-2 dark:border-zinc-800">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  {shownCard.image ? <img src={shownCard.image} alt="" className="h-16 w-24 shrink-0 rounded object-cover" /> : null}
                  <div className="min-w-0 flex-1">
                    <p className="line-clamp-2 text-[13px] font-medium">{shownCard.title}</p>
                    <p className="line-clamp-2 text-[11px] text-zinc-500">{shownCard.description}</p>
                  </div>
                </div>
              ) : null}
            </div>

            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <p className="text-xs font-medium text-zinc-700 dark:text-zinc-300">Post to</p>
                <button type="button" className="text-[11px] text-accent-700 hover:underline dark:text-accent-400"
                  onClick={() => setSelected(selected.length === active.length ? [] : active.map((t) => t.id))}>
                  {selected.length === active.length ? 'Clear' : 'Every account'}
                </button>
              </div>
              {brands.map(([brand, ts]) => {
                const ids = ts.map((t) => t.id);
                const all = ids.every((id) => selected.includes(id));
                return (
                  <div key={brand} className="flex flex-wrap items-center gap-1.5">
                    <button type="button" aria-pressed={all}
                      onClick={() => setSelected(all ? selected.filter((x) => !ids.includes(x)) : [...new Set([...selected, ...ids])])}
                      className={cn('h-8 rounded-full border px-3 text-xs font-semibold transition-colors',
                        all ? 'border-zinc-900 bg-zinc-900 text-white dark:border-zinc-100 dark:bg-zinc-100 dark:text-zinc-900' : 'border-zinc-300 text-zinc-700 hover:border-zinc-500 dark:border-zinc-700 dark:text-zinc-300')}>
                      {brand}
                    </button>
                    {ts.map((t) => {
                      const on = selected.includes(t.id);
                      return (
                        <button key={t.id} type="button" aria-pressed={on} title={`${t.brand} · ${accountName(t)}`}
                          onClick={() => setSelected(on ? selected.filter((x) => x !== t.id) : [...selected, t.id])}
                          className={cn('inline-flex h-8 items-center gap-1.5 rounded-full border px-2.5 text-xs transition-colors',
                            on ? 'border-accent-600 bg-accent-600/10 font-medium text-zinc-900 dark:text-zinc-50'
                              : 'border-zinc-200 text-zinc-500 hover:border-zinc-400 dark:border-zinc-800')}>
                          <PlatformIcon platform={t.platform} />
                          {accountName(t)}
                        </button>
                      );
                    })}
                  </div>
                );
              })}
            </div>

            <Field label="Copy" htmlFor="pub-copy" hint="Filled from the headline. Shared by every account; write a version for one account on the right.">
              <Textarea id="pub-copy" rows={4} className="text-[14px]" value={copy} onChange={(e) => setCopy(e.target.value)} />
            </Field>

            <div className="space-y-2">
              <p className="text-xs font-medium text-zinc-700 dark:text-zinc-300">Image</p>
              <div className="flex flex-wrap gap-2">
                {mediaList.map((m) => (
                  <div key={m} className="relative">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={m} alt="" className="h-20 w-20 rounded-md border border-zinc-200 object-cover dark:border-zinc-800" />
                    <button type="button" aria-label="Remove image" onClick={() => setMedia(mediaList.filter((x) => x !== m).join('\n'))}
                      className="absolute -right-1.5 -top-1.5 grid h-5 w-5 place-items-center rounded-full bg-zinc-900 text-white">
                      <X className="h-3 w-3" />
                    </button>
                  </div>
                ))}
                {card?.image && !mediaList.includes(card.image) ? (
                  <button type="button" onClick={() => setMedia([...mediaList, card.image!].join('\n'))}
                    className="h-20 rounded-md border border-dashed border-zinc-300 px-3 text-[11px] text-zinc-500 hover:border-zinc-500 dark:border-zinc-700">
                    Use story image
                  </button>
                ) : null}
              </div>
              <Input aria-label="Add image URL" placeholder="Or paste an image URL and press Enter" className="h-8 text-xs"
                onKeyDown={(e) => {
                  const v = (e.target as HTMLInputElement).value.trim();
                  if (e.key === 'Enter' && /^https:\/\//.test(v)) {
                    e.preventDefault();
                    setMedia([...mediaList, v].join('\n'));
                    (e.target as HTMLInputElement).value = '';
                  }
                }} />
            </div>

            <button type="button" onClick={() => setShowMore(!showMore)} className="text-xs text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100">
              {showMore ? '− Fewer options' : '+ Headline override, labels, Instagram collaborators'}
            </button>
            {showMore ? (
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="Card headline" htmlFor="pub-title" className="sm:col-span-2">
                  <Input id="pub-title" value={linkTitle} placeholder={card?.title ?? ''} onChange={(e) => setLinkTitle(e.target.value)} />
                </Field>
                <Field label="Labels" htmlFor="pub-labels" hint="Comma separated, e.g. breaking, sports.">
                  <Input id="pub-labels" value={labels} onChange={(e) => setLabels(e.target.value)} />
                </Field>
                {hasIg ? (
                  <Field label="Instagram collaborators" htmlFor="pub-collab" hint="Up to three public accounts.">
                    <Input id="pub-collab" placeholder="@bostonglobe" value={collabs} onChange={(e) => setCollabs(e.target.value)} />
                  </Field>
                ) : null}
              </div>
            ) : null}
          </div>

          {/* Right: when, then exactly what each account will post */}
          <div className="space-y-3 border-t border-zinc-200 bg-zinc-50 p-5 lg:overflow-y-auto lg:border-l lg:border-t-0 dark:border-zinc-800 dark:bg-zinc-900/40">
            <div className="space-y-3 rounded-lg border border-zinc-200 bg-white p-3 dark:border-zinc-800 dark:bg-zinc-950">
              <div role="tablist" aria-label="When to send" className="grid grid-cols-4 gap-1 rounded-md bg-zinc-100 p-1 dark:bg-zinc-900">
                {MODES.map((m) => (
                  <button key={m.id} type="button" role="tab" aria-selected={mode === m.id} onClick={() => setMode(m.id)}
                    className={cn('rounded px-2 py-1.5 text-xs font-medium transition-colors',
                      mode === m.id ? 'bg-white text-zinc-900 shadow-sm dark:bg-zinc-800 dark:text-zinc-50' : 'text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200')}>
                    {m.label}
                  </button>
                ))}
              </div>
              {mode === 'optimize' ? (
                <>
                  <div className="flex flex-wrap gap-1.5">
                    {PRESETS.map((p) => (
                      <Button key={p.id} size="sm" variant={preset === p.id ? 'primary' : 'secondary'} onClick={() => choosePreset(p.id)}>{p.label}</Button>
                    ))}
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <Input type="datetime-local" aria-label="Window start" className="h-8 text-xs" value={start} onChange={(e) => { setPreset(''); setStart(e.target.value); }} />
                    <Input type="datetime-local" aria-label="Window end" className="h-8 text-xs" value={end} onChange={(e) => { setPreset(''); setEnd(e.target.value); }} />
                  </div>
                  <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs">
                    <label className="flex items-center gap-1.5"><input type="radio" checked={priority === 'must'} onChange={() => setPriority('must')} /> Must send</label>
                    <label className="flex items-center gap-1.5"><input type="radio" checked={priority === 'can'} onChange={() => setPriority('can')} /> Can send <span className="text-zinc-400">(skips if no good slot)</span></label>
                  </div>
                </>
              ) : mode === 'schedule' ? (
                <Input type="datetime-local" aria-label="Post at" value={exact} onChange={(e) => setExact(e.target.value)} />
              ) : (
                <p className="text-[11px] text-zinc-500">{MODES.find((m) => m.id === mode)!.hint}</p>
              )}
            </div>

            {previewError ? <p className="text-xs text-red-600">{previewError}</p> : null}
            {!plans.length ? (
              <p className="rounded-lg border border-dashed border-zinc-300 p-8 text-center text-xs text-zinc-500 dark:border-zinc-700">
                Pick where it goes to see each post exactly as it will look.
              </p>
            ) : plans.map((p) => (
              <div key={p.targetId} className="space-y-2 rounded-lg border border-zinc-200 bg-white p-3 dark:border-zinc-800 dark:bg-zinc-950">
                <div className="flex items-center justify-between gap-2 text-[11px]">
                  <span className="font-medium text-zinc-600 dark:text-zinc-400">
                    {mode === 'hold' ? 'Held' : mode === 'now' ? 'Within a minute' : p.slot ? fmtWhen(p.slot.at) : 'No slot'}
                    {mode === 'optimize' && p.slot ? <span className="font-normal text-zinc-400"> · {friendlyReason(p.slot.reason)}</span> : null}
                  </span>
                  <span className={cn('pb-num', p.length > p.limit ? 'font-semibold text-red-600' : 'text-zinc-400')}>{p.length}/{p.limit}</span>
                </div>
                <PostMock platform={p.platform} brand={p.brand} text={p.finalText} linkUrl={p.linkUrl} linkMode={p.linkMode}
                  card={shownCard} image={mediaList[0] ?? null} />
                {!p.slot && p.slotError && mode === 'optimize' ? <p className="text-[11px] text-amber-700 dark:text-amber-400">{p.slotError}</p> : null}
                {p.problems.map((x) => (
                  <p key={x} className="flex items-start gap-1 text-[11px] text-amber-700 dark:text-amber-400">
                    <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" />{x}
                  </p>
                ))}
                {openVersion === p.targetId || overrides[p.targetId] ? (
                  <Textarea rows={3} aria-label={`Copy for ${p.label}`} className="text-[13px]" autoFocus={openVersion === p.targetId}
                    placeholder={copy} value={overrides[p.targetId] ?? ''}
                    onChange={(e) => setOverrides({ ...overrides, [p.targetId]: e.target.value })} />
                ) : (
                  <button type="button" className="text-[11px] text-accent-700 hover:underline dark:text-accent-400" onClick={() => setOpenVersion(p.targetId)}>
                    Write a different version for {PUBLISH_PLATFORM_LABELS[p.platform]}
                  </button>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      <footer className="flex shrink-0 flex-wrap items-center gap-2 border-t border-zinc-200 px-5 py-3 dark:border-zinc-800">
        <Button variant="primary" disabled={busy || !selected.length || (blocking && mode !== 'hold' && canApprove)}
          onClick={() => submit(mode === 'hold' ? 'draft' : canApprove ? 'schedule' : 'approval')}>
          {busy ? 'Working…' : primaryLabel}
        </Button>
        {canApprove && mode !== 'hold' ? (
          <Button disabled={busy || !selected.length} onClick={() => submit('approval')}>Send for approval</Button>
        ) : null}
        <span className="text-[11px] text-zinc-500">
          {selected.length ? `${selected.length} account${selected.length === 1 ? '' : 's'}` : 'Pick at least one account'}
        </span>
        {error ? <Badge tone="critical" className="ml-auto max-w-md whitespace-normal">{error}</Badge> : null}
      </footer>
    </div>
  );
}
