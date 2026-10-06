'use client';

import * as React from 'react';
import { AlertTriangle, Clock, Link2, Sparkles } from 'lucide-react';
import { Card, CardBody, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button, ButtonGroup, ButtonGroupItem } from '@/components/ui/button';
import { Field, Input, Textarea } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { PlatformIcon } from '@/components/ui/platform-icon';
import { cn } from '@/lib/utils';
import { PUBLISH_PLATFORM_LABELS } from '@/lib/publishing/platforms';
import { api, fmtWhen, toLocalInput, type Plan, type Target } from './api';

type TimingMode = 'window' | 'exact';

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
  { id: 'evening', label: 'This evening', range: () => [at(0, 17), at(0, 22)] },
  { id: 'tomorrow-am', label: 'Tomorrow morning', range: () => [at(1, 6), at(1, 11)] },
  { id: 'tomorrow', label: 'Tomorrow', range: () => [at(1, 6), at(1, 23)] },
  { id: 'weekend', label: 'This weekend', range: () => {
    const d = new Date(); const toSat = (6 - d.getDay() + 7) % 7 || (d.getDay() === 6 ? 0 : 7);
    return [at(toSat, 8), at(toSat + 1, 22)];
  } },
];

export function Composer({ targets, canApprove, onCreated }: {
  targets: Target[];
  canApprove: boolean;
  onCreated: () => void;
}) {
  const active = targets.filter((t) => t.active);
  const [selected, setSelected] = React.useState<string[]>([]);
  const [copy, setCopy] = React.useState('');
  const [overrides, setOverrides] = React.useState<Record<string, string>>({});
  const [link, setLink] = React.useState('');
  const [linkTitle, setLinkTitle] = React.useState('');
  const [media, setMedia] = React.useState('');
  const [collabs, setCollabs] = React.useState('');
  const [mode, setMode] = React.useState<TimingMode>('window');
  const [preset, setPreset] = React.useState('soon');
  const [start, setStart] = React.useState(() => toLocalInput(new Date()));
  const [end, setEnd] = React.useState(() => toLocalInput(new Date(Date.now() + 2 * 3600_000)));
  const [exact, setExact] = React.useState(() => toLocalInput(new Date(Date.now() + 30 * 60_000)));
  const [rawPlans, setPlans] = React.useState<Plan[]>([]);
  const [card, setCard] = React.useState<{ title: string; description: string; image: string | null } | null>(null);
  const [previewError, setPreviewError] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [message, setMessage] = React.useState<{ tone: 'ok' | 'error'; text: string } | null>(null);

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
    copyByTarget: Object.fromEntries(Object.entries(overrides).filter(([id]) => selected.includes(id))),
    linkUrl: link.trim() || null,
    linkTitle: linkTitle.trim() || null,
    mediaUrls: media.split(/\s+/).map((s) => s.trim()).filter(Boolean),
    instagramCollaborators: collabs.split(/[\s,]+/).map((s) => s.trim()).filter(Boolean),
    timing: mode === 'exact'
      ? { mode: 'exact', at: new Date(exact).toISOString() }
      : { mode: 'window', start: new Date(start).toISOString(), end: new Date(end).toISOString() },
    notes: null,
    submit,
  }), [selected, copy, overrides, link, linkTitle, media, collabs, mode, exact, start, end]);

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
    setMessage(null);
    try {
      const r = await api<{ status: string }>('/api/publishing/posts', { method: 'POST', json: body(kind) });
      setMessage({ tone: 'ok', text: r.status === 'approved' ? 'Scheduled.' : r.status === 'draft' ? 'Saved as a draft.' : 'Sent for approval.' });
      setCopy(''); setOverrides({}); setLink(''); setLinkTitle(''); setMedia(''); setCollabs(''); setPlans([]); setCard(null);
      lastLink.current = '';
      onCreated();
    } catch (e) {
      setMessage({ tone: 'error', text: (e as Error).message });
    } finally {
      setBusy(false);
    }
  };

  const plans = selected.length ? rawPlans : [];
  const hasIg = selected.some((id) => targets.find((t) => t.id === id)?.platform === 'instagram');
  const blocking = plans.some((p) => p.problems.some((x) => !x.startsWith('No link-in-bio')) || !p.slot);

  if (!targets.length) {
    return (
      <Card>
        <CardBody className="py-10 text-center text-sm text-zinc-500">
          No publishing accounts yet. An admin can add them under Accounts &amp; Feeds.
        </CardBody>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <div>
          <CardTitle>New post</CardTitle>
          <CardDescription>Write once. Each account gets its own copy, UTM tags and posting time.</CardDescription>
        </div>
      </CardHeader>
      <CardBody className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <div className="space-y-5">
          <div className="space-y-2">
            <p className="text-xs font-medium text-zinc-700 dark:text-zinc-300">Accounts</p>
            {brands.map(([brand, ts]) => (
              <div key={brand} className="flex flex-wrap items-center gap-1.5">
                <span className="w-28 shrink-0 truncate text-xs text-zinc-500">{brand}</span>
                {ts.map((t) => {
                  const on = selected.includes(t.id);
                  return (
                    <button
                      key={t.id}
                      type="button"
                      aria-pressed={on}
                      onClick={() => setSelected(on ? selected.filter((x) => x !== t.id) : [...selected, t.id])}
                      className={cn(
                        'inline-flex h-7 items-center gap-1.5 rounded-md border px-2 text-xs transition-colors',
                        on
                          ? 'border-accent-600 bg-accent-600/10 text-zinc-900 dark:text-zinc-50'
                          : 'border-zinc-200 text-zinc-600 hover:bg-zinc-50 dark:border-zinc-800 dark:text-zinc-400 dark:hover:bg-zinc-900',
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

          <Field label="Story link" htmlFor="pub-link" hint="UTMs are added per platform. On Bluesky the link goes in a card, not the text.">
            <Input id="pub-link" type="url" placeholder="https://www.boston.com/..." value={link} onChange={(e) => setLink(e.target.value)} />
          </Field>
          {card ? (
            <div className="flex gap-3 rounded-md border border-zinc-200 p-2 dark:border-zinc-800">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              {card.image ? <img src={card.image} alt="" className="h-16 w-24 shrink-0 rounded object-cover" /> : null}
              <div className="min-w-0 text-xs">
                <p className="font-medium text-zinc-900 dark:text-zinc-100">{linkTitle || card.title}</p>
                <p className="line-clamp-2 text-zinc-500">{card.description}</p>
              </div>
            </div>
          ) : null}
          <Field label="Card headline (optional)" htmlFor="pub-title" hint="Overrides the story's own headline on link cards and link in bio.">
            <Input id="pub-title" value={linkTitle} onChange={(e) => setLinkTitle(e.target.value)} />
          </Field>

          <Field label="Copy" htmlFor="pub-copy" hint="Used for every account unless you write a version for one below.">
            <Textarea id="pub-copy" rows={4} value={copy} onChange={(e) => setCopy(e.target.value)} />
          </Field>

          <Field label="Images or video (optional)" htmlFor="pub-media" hint="HTTPS URLs, one per line. Instagram and TikTok require one.">
            <Textarea id="pub-media" rows={2} value={media} onChange={(e) => setMedia(e.target.value)} />
          </Field>

          {hasIg ? (
            <Field label="Instagram collaborators (optional)" htmlFor="pub-collab" hint="Up to three public accounts. They get an invite to co-author the post.">
              <Input id="pub-collab" placeholder="@bostonglobe @statnews" value={collabs} onChange={(e) => setCollabs(e.target.value)} />
            </Field>
          ) : null}

          <div className="space-y-2">
            <div className="flex items-center justify-between gap-3">
              <p className="text-xs font-medium text-zinc-700 dark:text-zinc-300">When</p>
              <ButtonGroup>
                <ButtonGroupItem active={mode === 'window'} onClick={() => setMode('window')}>Window</ButtonGroupItem>
                <ButtonGroupItem active={mode === 'exact'} onClick={() => setMode('exact')}>Exact time</ButtonGroupItem>
              </ButtonGroup>
            </div>
            {mode === 'window' ? (
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
                <p className="text-[11px] text-zinc-500">
                  Each account posts at its best slot in this window, inside its posting hours and spaced from its other posts.
                </p>
              </>
            ) : (
              <Input type="datetime-local" aria-label="Post at" value={exact} onChange={(e) => setExact(e.target.value)} />
            )}
          </div>
        </div>

        <div className="space-y-3">
          <p className="text-xs font-medium text-zinc-700 dark:text-zinc-300">Preview by account</p>
          {previewError ? <p className="text-xs text-red-600">{previewError}</p> : null}
          {!plans.length ? (
            <p className="rounded-md border border-dashed border-zinc-200 p-6 text-center text-xs text-zinc-500 dark:border-zinc-800">
              Pick accounts to see exactly what each one will post, and when.
            </p>
          ) : plans.map((p) => (
            <div key={p.targetId} className="rounded-md border border-zinc-200 p-3 dark:border-zinc-800">
              <div className="mb-2 flex items-center justify-between gap-2">
                <span className="flex min-w-0 items-center gap-1.5 text-xs font-medium">
                  <PlatformIcon platform={p.platform} />
                  <span className="truncate">{p.brand} · {p.label}</span>
                </span>
                <span className={cn('pb-num text-[11px]', p.length > p.limit ? 'text-red-600' : 'text-zinc-500')}>
                  {p.length}/{p.limit}
                </span>
              </div>
              <Textarea
                rows={3}
                aria-label={`Copy for ${p.label}`}
                className="text-xs"
                placeholder={copy || 'Same as main copy'}
                value={overrides[p.targetId] ?? ''}
                onChange={(e) => setOverrides({ ...overrides, [p.targetId]: e.target.value })}
              />
              <p className="mt-2 whitespace-pre-wrap break-words rounded bg-zinc-50 p-2 text-xs text-zinc-700 dark:bg-zinc-900 dark:text-zinc-300">
                {p.finalText || <span className="text-zinc-400">(no text)</span>}
              </p>
              {p.linkUrl ? (
                <p className="mt-1.5 flex items-start gap-1 break-all text-[11px] text-zinc-500">
                  <Link2 className="mt-0.5 h-3 w-3 shrink-0" />
                  <span>
                    {p.linkMode === 'card' ? 'Link card: ' : p.linkMode === 'bio' ? 'Link in bio: ' : ''}
                    {p.linkUrl}
                  </span>
                </p>
              ) : null}
              <p className="mt-1.5 flex items-start gap-1 text-[11px] text-zinc-600 dark:text-zinc-400">
                {p.slot ? <Sparkles className="mt-0.5 h-3 w-3 shrink-0 text-accent-600" /> : <Clock className="mt-0.5 h-3 w-3 shrink-0" />}
                <span>{p.slot ? `${fmtWhen(p.slot.at)}. ${p.slot.reason}` : p.slotError}</span>
              </p>
              {p.problems.map((x) => (
                <p key={x} className="mt-1 flex items-start gap-1 text-[11px] text-amber-700 dark:text-amber-400">
                  <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" />{x}
                </p>
              ))}
            </div>
          ))}

          <div className="flex flex-wrap items-center gap-2 pt-2">
            {canApprove ? (
              <>
                <Button variant="primary" disabled={busy || !selected.length || blocking} onClick={() => submit('schedule')}>Schedule</Button>
                <Button disabled={busy || !selected.length} onClick={() => submit('approval')}>Send for approval</Button>
              </>
            ) : (
              <Button variant="primary" disabled={busy || !selected.length} onClick={() => submit('approval')}>Submit for approval</Button>
            )}
            <Button variant="ghost" disabled={busy || !selected.length} onClick={() => submit('draft')}>Save draft</Button>
            {message ? (
              <Badge tone={message.tone === 'ok' ? 'positive' : 'critical'}>{message.text}</Badge>
            ) : null}
          </div>
          {selected.length ? (
            <p className="text-[11px] text-zinc-500">
              Posting to {selected.length} account{selected.length === 1 ? '' : 's'} on{' '}
              {[...new Set(selected.map((id) => targets.find((t) => t.id === id)?.platform).filter(Boolean))]
                .map((p) => PUBLISH_PLATFORM_LABELS[p!]).join(', ')}.
            </p>
          ) : null}
        </div>
      </CardBody>
    </Card>
  );
}
