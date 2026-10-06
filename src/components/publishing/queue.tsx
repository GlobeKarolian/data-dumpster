'use client';

import * as React from 'react';
import { ExternalLink } from 'lucide-react';
import { Card, CardBody, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { PlatformIcon } from '@/components/ui/platform-icon';
import {
  api, dayKey, dayLabel, fmtTime, fmtWhen, toLocalInput, STATUS_LABEL, STATUS_TONE, type Delivery, type Post,
} from './api';

function DeliveryRow({ d, canApprove, onChange, onToggle, open }: {
  d: Delivery; canApprove: boolean; onChange: () => void; onToggle?: () => void; open?: boolean;
}) {
  const [moving, setMoving] = React.useState(false);
  const [when, setWhen] = React.useState(d.scheduled_for ? toLocalInput(new Date(d.scheduled_for)) : toLocalInput(new Date()));
  const [error, setError] = React.useState<string | null>(null);
  const act = async (json: unknown) => {
    setError(null);
    try {
      await api(`/api/publishing/deliveries/${d.id}`, { method: 'PATCH', json });
      setMoving(false);
      onChange();
    } catch (e) {
      setError((e as Error).message);
    }
  };
  const actionable = ['queued', 'failed', 'unschedulable'].includes(d.status);
  return (
    <div className="flex flex-col gap-1 py-2 text-xs sm:flex-row sm:items-start sm:gap-3">
      <span className="pb-num w-20 shrink-0 text-zinc-500">
        {d.sent_at ? fmtTime(d.sent_at) : d.scheduled_for ? fmtTime(d.scheduled_for) : '—'}
      </span>
      <span className="flex w-44 shrink-0 items-center gap-1.5 truncate">
        <PlatformIcon platform={d.platform} />
        <span className="truncate">{d.brand} · {d.label}</span>
      </span>
      <div className="min-w-0 flex-1 space-y-1">
        <div className="flex flex-wrap items-center gap-1.5">
          <Badge tone={STATUS_TONE[d.status]}>{STATUS_LABEL[d.status]}</Badge>
          {d.slot_reason && d.status !== 'sent' ? <span className="text-zinc-500">{d.slot_reason}</span> : null}
          {d.post_url ? (
            <a href={d.post_url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-0.5 text-accent-700 hover:underline dark:text-accent-400">
              View <ExternalLink className="h-3 w-3" />
            </a>
          ) : null}
          {d.provider === 'mock' ? <Badge tone="outline">test mode</Badge> : null}
        </div>
        {d.last_error ? <p className="text-red-600 dark:text-red-400">{d.last_error}</p> : null}
        {moving ? (
          <div className="flex flex-wrap items-center gap-1.5">
            <Input type="datetime-local" className="h-7 w-52 text-xs" value={when} onChange={(e) => setWhen(e.target.value)} />
            <Button size="sm" variant="primary" onClick={() => act({ action: 'reschedule', at: new Date(when).toISOString() })}>Move</Button>
            <Button size="sm" variant="ghost" onClick={() => setMoving(false)}>Cancel</Button>
          </div>
        ) : null}
        {error ? <p className="text-red-600">{error}</p> : null}
      </div>
      {(onToggle || (canApprove && actionable)) && !moving ? (
        <div className="flex shrink-0 gap-1">
          {onToggle ? <Button size="sm" variant="ghost" onClick={onToggle}>{open ? 'Hide' : 'Details'}</Button> : null}
          {canApprove && actionable ? (
            <>
              <Button size="sm" variant="ghost" onClick={() => setMoving(true)}>Move</Button>
              <Button size="sm" variant="ghost" onClick={() => act({ action: 'send_now' })}>Send now</Button>
              <Button size="sm" variant="ghost" onClick={() => act({ action: 'cancel' })}>Remove</Button>
            </>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function TimelineRow({ p, d, canApprove, onChange, onCancelPost }: {
  p: Post; d: Delivery; canApprove: boolean; onChange: () => void; onCancelPost: () => void;
}) {
  const [open, setOpen] = React.useState(false);
  return (
    <div>
      <DeliveryRow d={d} canApprove={canApprove} onChange={onChange} onToggle={() => setOpen(!open)} open={open} />
      {open ? (
        <div className="mb-2 space-y-1 rounded bg-zinc-50 p-2 text-xs sm:ml-[17.5rem] dark:bg-zinc-900">
          <p className="whitespace-pre-wrap break-words">{d.final_text}</p>
          {d.link_url ? <p className="break-all text-zinc-500">{d.link_mode === 'card' ? 'Card: ' : d.link_mode === 'bio' ? 'Bio: ' : ''}{d.link_url}</p> : null}
          <PostSummary p={p} />
          {canApprove && d.status === 'queued' ? (
            <Button size="sm" variant="ghost" onClick={onCancelPost}>Cancel on every account</Button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function PostSummary({ p }: { p: Post }) {
  return (
    <div className="min-w-0 space-y-1">
      <p className="line-clamp-2 text-sm text-zinc-900 dark:text-zinc-100">{p.base_copy || p.link_title || p.link_url || '(no copy)'}</p>
      <p className="flex flex-wrap gap-x-3 text-[11px] text-zinc-500">
        {p.link_url ? <span className="truncate">{p.link_url}</span> : null}
        <span>{p.origin === 'rss' ? p.created_by_email?.replace(/^rss:/, 'RSS: ') : p.created_by_email}</span>
        <span>
          {p.timing.mode === 'window'
            ? `Window ${fmtWhen(p.timing.start)} to ${fmtWhen(p.timing.end)}`
            : `At ${fmtWhen(p.timing.at)}`}
        </span>
      </p>
    </div>
  );
}

export function Queue({ posts, canApprove, onChange, me }: {
  posts: Post[];
  canApprove: boolean;
  onChange: () => void;
  me: string | null;
}) {
  const [error, setError] = React.useState<string | null>(null);
  const postAction = async (id: string, action: 'approve' | 'cancel') => {
    setError(null);
    try {
      await api(`/api/publishing/posts/${id}`, { method: 'PATCH', json: { action } });
      onChange();
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const pending = posts.filter((p) => p.status === 'pending_approval' || p.status === 'draft');
  const approved = posts.filter((p) => p.status === 'approved');
  const problems = approved.flatMap((p) => p.deliveries.filter((d) => d.status === 'failed' || d.status === 'unschedulable'));
  const timeline = approved
    .flatMap((p) => p.deliveries.filter((d) => ['queued', 'sending', 'sent'].includes(d.status)).map((d) => ({ p, d })))
    .sort((a, b) => (a.d.sent_at ?? a.d.scheduled_for ?? '').localeCompare(b.d.sent_at ?? b.d.scheduled_for ?? ''));
  const byDay = new Map<string, typeof timeline>();
  for (const row of timeline) {
    const k = dayKey(row.d.sent_at ?? row.d.scheduled_for!);
    byDay.set(k, [...(byDay.get(k) ?? []), row]);
  }

  return (
    <div className="space-y-4">
      {error ? <p className="text-sm text-red-600">{error}</p> : null}

      {pending.length ? (
        <Card>
          <CardHeader>
            <div>
              <CardTitle>Waiting for approval</CardTitle>
              <CardDescription>
                {canApprove ? 'Approving picks each account’s slot against the queue as it stands now.' : 'An admin will review these.'}
              </CardDescription>
            </div>
          </CardHeader>
          <CardBody className="divide-y divide-zinc-100 dark:divide-zinc-800">
            {pending.map((p) => (
              <div key={p.id} className="flex flex-col gap-2 py-3 sm:flex-row sm:items-start sm:justify-between">
                <div className="min-w-0 space-y-1.5">
                  <div className="flex flex-wrap gap-1.5">
                    {p.status === 'draft' ? <Badge tone="outline">Draft</Badge> : null}
                    {p.deliveries.map((d) => (
                      <Badge key={d.id} tone="neutral"><PlatformIcon platform={d.platform} />{d.label}</Badge>
                    ))}
                  </div>
                  <PostSummary p={p} />
                  {p.notes ? <p className="text-[11px] text-amber-700 dark:text-amber-400">{p.notes}</p> : null}
                </div>
                <div className="flex shrink-0 gap-1.5">
                  {canApprove ? <Button size="sm" variant="primary" onClick={() => postAction(p.id, 'approve')}>Approve</Button> : null}
                  {canApprove || p.created_by_email === me ? (
                    <Button size="sm" variant="ghost" onClick={() => postAction(p.id, 'cancel')}>Discard</Button>
                  ) : null}
                </div>
              </div>
            ))}
          </CardBody>
        </Card>
      ) : null}

      {problems.length ? (
        <Card className="border-red-200 dark:border-red-900/60">
          <CardHeader><CardTitle>Needs attention</CardTitle></CardHeader>
          <CardBody className="divide-y divide-zinc-100 dark:divide-zinc-800">
            {problems.map((d) => <DeliveryRow key={d.id} d={d} canApprove={canApprove} onChange={onChange} />)}
          </CardBody>
        </Card>
      ) : null}

      <Card>
        <CardHeader>
          <div>
            <CardTitle>Queue</CardTitle>
            <CardDescription>Times are Boston time. Sent posts stay here for two days.</CardDescription>
          </div>
        </CardHeader>
        <CardBody>
          {!byDay.size ? (
            <p className="py-6 text-center text-sm text-zinc-500">Nothing queued.</p>
          ) : [...byDay.entries()].map(([k, rows]) => (
            <div key={k} className="mb-4 last:mb-0">
              <h3 className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-zinc-500">{dayLabel(k)}</h3>
              <div className="divide-y divide-zinc-100 dark:divide-zinc-800">
                {rows.map(({ p, d }) => (
                  <TimelineRow key={d.id} p={p} d={d} canApprove={canApprove} onChange={onChange} onCancelPost={() => postAction(p.id, 'cancel')} />
                ))}
              </div>
            </div>
          ))}
        </CardBody>
      </Card>
    </div>
  );
}
