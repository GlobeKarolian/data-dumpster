'use client';

import * as React from 'react';
import { AlertTriangle, Clock, Link2, Sparkles, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Field, Input, Textarea } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { PlatformIcon } from '@/components/ui/platform-icon';
import { cn } from '@/lib/utils';
import { api, fmtWhen, toLocalInput, type Plan, type Target } from './api';

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
  const [selected, setSelected] = React.useState<string[]>(prefill?.targetIds ?? []);
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

  // Live dry run: exact text, tagged link and the slot each account would get.
  const lastLink = React.useRef('');
  React.useEffect(() => {
    if (!selected.length) return;
    const withCard = link.trim() !== lastLink.current;
    const handle = setTimeout(async () => {
      try {
        const r = await api<{ plans: Plan[]; card: typeof card }>('/api/publishing/preview', { method: 'POST', json: { ...body('schedule'), withCard } });
        setPlans(r.plans);
        if (withCard) { setCard(r.card); lastLink.current = link.trim(); }
        setPreviewError(null);
      } catch (e) {
        setPreviewError((e as Error).message);
      }
    }, 600);
    return () => clearTimeout(handle);
  }, [body, selected.length, link]);

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
  const blocking = plans.some((p) => p.problems.some((x) => !x.startsWith('No link-in-bio')) || (!p.slot && !(mode === 'optimize' && priority === 'can')));
  const primaryLabel = mode === 'hold' ? 'Hold' : !canApprove ? 'Submit for approval' : mode === 'now' ? 'Publish now' : mode === 'schedule' ? 'Schedule' : 'Add to queue';

  return (
    <div className="flex h-full flex-col">
      <header className="flex h-14 shrink-0 items-center justify-between border-b border-zinc-200 px-5 dark:border-zinc-800">
        <h2 className="text-sm font-semibold">New post</h2>
        <Button size="icon" variant="ghost" aria-label="Close" onClick={onClose}><X className="h-4 w-4" /></Button>
      </header>

      {!targets.length ? (
        <p className="p-10 text-center text-sm text-zinc-500">No accounts yet. An admin can add them under Accounts.</p>
      ) : (
        <div className="grid min-h-0 flex-1 overflow-y-auto lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] lg:overflow-hidden">
          {/* Left: what and where */}
          <div className="space-y-5 p-5 lg:overflow-y-auto">
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <p className="text-xs font-medium text-zinc-700 dark:text-zinc-300">Accounts</p>
                <button type="button" className="text-[11px] text-accent-700 hover:underline dark:text-accent-400"
                  onClick={() => setSelected(selected.length === active.length ? [] : active.map((t) => t.id))}>
                  {selected.length === active.length ? 'Clear' : 'Select all'}
                </button>
              </div>
              {brands.map(([brand, ts]) => (
                <div key={brand} className="flex flex-wrap items-center gap-1.5">
                  <button type="button" className="w-28 shrink-0 truncate text-left text-xs text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100"
                    title="Select every account for this brand"
                    onClick={() => {
                      const ids = ts.map((t) => t.id);
                      const all = ids.every((id) => selected.includes(id));
                      setSelected(all ? selected.filter((x) => !ids.includes(x)) : [...new Set([...selected, ...ids])]);
                    }}>
                    {brand}
                  </button>
                  {ts.map((t) => {
                    const on = selected.includes(t.id);
                    return (
                      <button
                        key={t.id}
                        type="button"
                        aria-pressed={on}
                        title={`${t.brand} · ${t.label}`}
                        onClick={() => setSelected(on ? selected.filter((x) => x !== t.id) : [...selected, t.id])}
                        className={cn(
                          'inline-flex h-8 items-center gap-1.5 rounded-full border px-2.5 text-xs transition-colors',
                          on
                            ? 'border-accent-600 bg-accent-600/10 text-zinc-900 dark:text-zinc-50'
                            : 'border-zinc-200 text-zinc-500 opacity-70 hover:opacity-100 dark:border-zinc-800',
                        )}
                      >
                        <PlatformIcon platform={t.platform} />
                        {t.label}
                      </button>
                    );
                  })}
                </div>
              ))}
            </div>

            <Field label="Story link" htmlFor="pub-link">
              <Input id="pub-link" type="url" placeholder="https://www.boston.com/..." value={link} onChange={(e) => setLink(e.target.value)} />
            </Field>
            {card ? (
              <div className="flex gap-3 rounded-md border border-zinc-200 p-2 dark:border-zinc-800">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                {card.image ? <img src={card.image} alt="" className="h-16 w-24 shrink-0 rounded object-cover" /> : null}
                <div className="min-w-0 flex-1 space-y-1 text-xs">
                  <Input aria-label="Card headline" className="h-7 text-xs font-medium" value={linkTitle || card.title}
                    onChange={(e) => setLinkTitle(e.target.value)} />
                  <p className="line-clamp-2 text-zinc-500">{card.description}</p>
                </div>
              </div>
            ) : null}

            <Field label="Copy" htmlFor="pub-copy" hint="Shared by every account unless you write its own version on the right.">
              <Textarea id="pub-copy" rows={5} value={copy} onChange={(e) => setCopy(e.target.value)} />
            </Field>

            <Field label="Image or video URLs" htmlFor="pub-media" hint="One per line. Instagram and TikTok need one.">
              <Textarea id="pub-media" rows={2} value={media} onChange={(e) => setMedia(e.target.value)}
                placeholder={card?.image ?? ''} />
            </Field>
            {card?.image && !media.trim() ? (
              <button type="button" className="-mt-3 text-[11px] text-accent-700 hover:underline dark:text-accent-400" onClick={() => setMedia(card.image!)}>
                Use the story image
              </button>
            ) : null}

            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Labels" htmlFor="pub-labels" hint="Comma separated, e.g. breaking, sports.">
                <Input id="pub-labels" value={labels} onChange={(e) => setLabels(e.target.value)} />
              </Field>
              {hasIg ? (
                <Field label="Instagram collaborators" htmlFor="pub-collab" hint="Up to three public accounts.">
                  <Input id="pub-collab" placeholder="@bostonglobe" value={collabs} onChange={(e) => setCollabs(e.target.value)} />
                </Field>
              ) : null}
            </div>

            <div className="space-y-3 rounded-lg border border-zinc-200 p-3 dark:border-zinc-800">
              <div role="tablist" aria-label="When to send" className="grid grid-cols-4 gap-1 rounded-md bg-zinc-100 p-1 dark:bg-zinc-900">
                {MODES.map((m) => (
                  <button key={m.id} type="button" role="tab" aria-selected={mode === m.id} onClick={() => setMode(m.id)}
                    className={cn('rounded px-2 py-1.5 text-xs font-medium transition-colors',
                      mode === m.id ? 'bg-white text-zinc-900 shadow-sm dark:bg-zinc-800 dark:text-zinc-50' : 'text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200')}>
                    {m.label}
                  </button>
                ))}
              </div>
              <p className="text-[11px] text-zinc-500">{MODES.find((m) => m.id === mode)!.hint}</p>
              {mode === 'optimize' ? (
                <>
                  <div className="flex flex-wrap gap-1.5">
                    {PRESETS.map((p) => (
                      <Button key={p.id} size="sm" variant={preset === p.id ? 'primary' : 'secondary'} onClick={() => choosePreset(p.id)}>{p.label}</Button>
                    ))}
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <Input type="datetime-local" aria-label="Window start" value={start} onChange={(e) => { setPreset(''); setStart(e.target.value); }} />
                    <Input type="datetime-local" aria-label="Window end" value={end} onChange={(e) => { setPreset(''); setEnd(e.target.value); }} />
                  </div>
                  <div className="flex gap-4 text-xs">
                    <label className="flex items-center gap-1.5">
                      <input type="radio" checked={priority === 'must'} onChange={() => setPriority('must')} /> Must send
                    </label>
                    <label className="flex items-center gap-1.5">
                      <input type="radio" checked={priority === 'can'} onChange={() => setPriority('can')} /> Can send
                      <span className="text-zinc-400">(expires if no good slot)</span>
                    </label>
                  </div>
                </>
              ) : mode === 'schedule' ? (
                <Input type="datetime-local" aria-label="Post at" value={exact} onChange={(e) => setExact(e.target.value)} />
              ) : null}
            </div>
          </div>

          {/* Right: exactly what each account will post */}
          <div className="space-y-3 border-t border-zinc-200 bg-zinc-50/60 p-5 lg:overflow-y-auto lg:border-l lg:border-t-0 dark:border-zinc-800 dark:bg-zinc-900/30">
            <p className="text-xs font-medium text-zinc-700 dark:text-zinc-300">What each account will post</p>
            {previewError ? <p className="text-xs text-red-600">{previewError}</p> : null}
            {!plans.length ? (
              <p className="rounded-md border border-dashed border-zinc-300 p-8 text-center text-xs text-zinc-500 dark:border-zinc-700">
                Pick accounts to see the exact post, tagged link and time for each.
              </p>
            ) : plans.map((p) => (
              <div key={p.targetId} className="rounded-lg border border-zinc-200 bg-white p-3 dark:border-zinc-800 dark:bg-zinc-950">
                <div className="mb-2 flex items-center justify-between gap-2">
                  <span className="flex min-w-0 items-center gap-1.5 text-xs font-medium">
                    <PlatformIcon platform={p.platform} />
                    <span className="truncate">{p.brand} · {p.label}</span>
                  </span>
                  <span className={cn('pb-num text-[11px]', p.length > p.limit ? 'font-semibold text-red-600' : 'text-zinc-500')}>
                    {p.length}/{p.limit}
                  </span>
                </div>
                <Textarea
                  rows={3}
                  aria-label={`Copy for ${p.label}`}
                  className="text-[13px]"
                  placeholder={p.finalText || 'Same as main copy'}
                  value={overrides[p.targetId] ?? ''}
                  onChange={(e) => setOverrides({ ...overrides, [p.targetId]: e.target.value })}
                />
                {p.linkUrl ? (
                  <p className="mt-1.5 flex items-start gap-1 break-all text-[11px] text-zinc-500">
                    <Link2 className="mt-0.5 h-3 w-3 shrink-0" />
                    <span>{p.linkMode === 'card' ? 'Link card, not in text: ' : p.linkMode === 'bio' ? 'Link in bio: ' : 'In text: '}{p.linkUrl}</span>
                  </p>
                ) : null}
                {mode !== 'hold' ? (
                  <p className="mt-1.5 flex items-start gap-1 text-[11px] text-zinc-700 dark:text-zinc-300">
                    {p.slot ? <Sparkles className="mt-0.5 h-3 w-3 shrink-0 text-accent-600" /> : <Clock className="mt-0.5 h-3 w-3 shrink-0" />}
                    <span>
                      {mode === 'now' ? 'Within a minute' : p.slot ? `${fmtWhen(p.slot.at)} · ${p.slot.reason.replace(/^[A-Z][a-z]{2} \d{1,2}(:\d{2})?[ap]m: /, '')}` : p.slotError}
                    </span>
                  </p>
                ) : null}
                {p.problems.map((x) => (
                  <p key={x} className="mt-1 flex items-start gap-1 text-[11px] text-amber-700 dark:text-amber-400">
                    <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" />{x}
                  </p>
                ))}
              </div>
            ))}
          </div>
        </div>
      )}

      <footer className="flex shrink-0 flex-wrap items-center gap-2 border-t border-zinc-200 px-5 py-3 dark:border-zinc-800">
        <Button variant="primary" disabled={busy || !selected.length || (blocking && mode !== 'hold' && canApprove)}
          onClick={() => submit(mode === 'hold' ? 'draft' : canApprove ? 'schedule' : 'approval')}>
          {primaryLabel}
        </Button>
        {canApprove && mode !== 'hold' ? (
          <Button disabled={busy || !selected.length} onClick={() => submit('approval')}>Send for approval</Button>
        ) : null}
        <span className="text-[11px] text-zinc-500">
          {selected.length ? `${selected.length} account${selected.length === 1 ? '' : 's'}` : 'No accounts selected'}
        </span>
        {error ? <Badge tone="critical" className="ml-auto max-w-md whitespace-normal">{error}</Badge> : null}
      </footer>
    </div>
  );
}
