'use client';

import * as React from 'react';
import { AlertTriangle, ExternalLink, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input, Textarea } from '@/components/ui/input';
import { PlatformIcon } from '@/components/ui/platform-icon';
import { cn } from '@/lib/utils';
import { chargedLength, PUBLISH_PLATFORM_LABELS, TEXT_LIMITS } from '@/lib/publishing/platforms';
import { api, fmtWhen, toLocalInput, type Delivery, type Post } from './api';
import { PostBody, shortUrl } from './bits';
import { usePublish } from './shell';

/**
 * Everything about one story, in one panel: what each network will say, when,
 * and the handful of things an editor does to a queued post. Opened by clicking
 * a story anywhere (the list or the calendar).
 */

export const STATUS_WORDS: Record<Delivery['status'], { label: string; cls: string }> = {
  queued: { label: 'Scheduled', cls: 'bg-blue-50 text-blue-700 dark:bg-blue-950/50 dark:text-blue-300' },
  sending: { label: 'Posting…', cls: 'bg-blue-50 text-blue-700 dark:bg-blue-950/50 dark:text-blue-300' },
  sent: { label: 'Posted', cls: 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-300' },
  held: { label: 'Not scheduled yet', cls: 'bg-amber-50 text-amber-800 dark:bg-amber-950/50 dark:text-amber-300' },
  failed: { label: 'Failed', cls: 'bg-red-50 text-red-700 dark:bg-red-950/50 dark:text-red-300' },
  unschedulable: { label: 'No time found', cls: 'bg-red-50 text-red-700 dark:bg-red-950/50 dark:text-red-300' },
  canceled: { label: 'Canceled', cls: 'bg-zinc-100 text-zinc-500 dark:bg-zinc-800' },
};

export function headlineOf(p: Post): string {
  return p.link_title || p.options?.card?.title || p.base_copy.split('\n')[0] || (p.link_url ? shortUrl(p.link_url) : 'Untitled post');
}

export function imageOf(p: Post): string | null {
  return p.media_urls[0] ?? p.options?.card?.image ?? null;
}

export function StoryDrawer({ post, onClose }: { post: Post; onClose: () => void }) {
  const { canApprove, me, refresh, toast, openComposer } = usePublish();
  const act = async (url: string, json: unknown, ok: string) => {
    try { await api(url, { method: 'PATCH', json }); toast(ok); refresh(); }
    catch (e) { toast((e as Error).message); }
  };
  const pending = post.deliveries.filter((d) => ['queued', 'failed', 'unschedulable', 'held'].includes(d.status));
  const awaiting = post.status === 'pending_approval' || post.status === 'draft';
  const img = imageOf(post);

  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <button type="button" aria-label="Close" className="absolute inset-0 bg-black/30" onClick={onClose} />
      <aside role="dialog" aria-modal="true" aria-label={headlineOf(post)}
        className="relative flex h-full w-full max-w-xl flex-col bg-white shadow-2xl dark:bg-zinc-950">
        <header className="flex items-start gap-3 border-b border-zinc-200 p-4 dark:border-zinc-800">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          {img ? <img src={img} alt="" className="h-16 w-16 shrink-0 rounded-lg object-cover" /> : null}
          <div className="min-w-0 flex-1">
            <h2 className="text-[15px] font-semibold leading-snug">{headlineOf(post)}</h2>
            {post.link_url ? (
              <a href={post.link_url} target="_blank" rel="noreferrer" className="mt-0.5 inline-flex items-center gap-1 text-xs text-zinc-500 hover:underline">
                {shortUrl(post.link_url)} <ExternalLink className="h-3 w-3" />
              </a>
            ) : null}
            <p className="mt-1 text-[11px] text-zinc-400">
              {post.origin === 'rss' ? `Auto-posted from ${post.created_by_email?.replace(/^rss:/, '') ?? 'RSS'}` : `By ${post.created_by_email ?? 'unknown'}`}
              {post.approved_by_email && post.approved_by_email !== post.created_by_email ? ` · approved by ${post.approved_by_email}` : ''}
            </p>
          </div>
          <Button size="icon" variant="ghost" aria-label="Close" onClick={onClose}><X className="h-4 w-4" /></Button>
        </header>

        {awaiting ? (
          <div className="flex flex-wrap items-center gap-2 border-b border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-200">
            <span className="flex-1">{post.status === 'draft' ? 'This is a draft. It will not post until it is scheduled.' : 'Waiting for review. Nothing posts until it is approved.'}</span>
            {post.notes ? <span className="w-full text-xs">{post.notes}</span> : null}
            {canApprove ? (
              <Button size="sm" variant="primary" onClick={() => act(`/api/publishing/posts/${post.id}`, { action: 'approve' }, 'Scheduled.')}>
                {post.status === 'draft' ? 'Schedule it' : 'Approve and schedule'}
              </Button>
            ) : null}
          </div>
        ) : null}

        <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-4">
          {post.deliveries.map((d) => <NetworkPost key={d.id} d={d} canEdit={canApprove} onAct={act} />)}
        </div>

        <footer className="flex flex-wrap items-center gap-2 border-t border-zinc-200 p-4 dark:border-zinc-800">
          <Button onClick={() => { onClose(); openComposer({ link: post.link_url ?? undefined, copy: post.base_copy, media: post.media_urls, targetIds: post.deliveries.map((d) => d.target_id) }); }}>
            Share again
          </Button>
          {pending.length && (canApprove || post.created_by_email === me) ? (
            <Button variant="danger" className="ml-auto" onClick={async () => { await act(`/api/publishing/posts/${post.id}`, { action: 'cancel' }, 'Canceled.'); onClose(); }}>
              Cancel {pending.length === post.deliveries.length ? 'post' : 'remaining'}
            </Button>
          ) : null}
        </footer>
      </aside>
    </div>
  );
}

function NetworkPost({ d, canEdit, onAct }: {
  d: Delivery; canEdit: boolean; onAct: (url: string, json: unknown, ok: string) => Promise<void>;
}) {
  const [mode, setMode] = React.useState<'view' | 'edit' | 'time'>('view');
  const [text, setText] = React.useState(d.final_text);
  const [when, setWhen] = React.useState(() => toLocalInput(d.scheduled_for ? new Date(d.scheduled_for) : new Date(Date.now() + 3600_000)));
  const s = STATUS_WORDS[d.status];
  const len = chargedLength(d.platform, text);
  const limit = TEXT_LIMITS[d.platform];
  const changeable = canEdit && ['queued', 'failed', 'unschedulable'].includes(d.status);
  const url = `/api/publishing/deliveries/${d.id}`;
  const time = d.sent_at ?? d.scheduled_for;

  return (
    <div className={cn('rounded-xl border p-3', d.status === 'canceled' ? 'border-zinc-100 opacity-60 dark:border-zinc-800' : 'border-zinc-200 dark:border-zinc-800')}>
      <div className="flex items-center gap-2">
        <PlatformIcon platform={d.platform} className="h-4 w-4" />
        <span className="text-sm font-semibold">{d.brand} {PUBLISH_PLATFORM_LABELS[d.platform]}</span>
        <span className={cn('rounded-full px-2 py-0.5 text-[11px] font-medium', s.cls)}>{s.label}</span>
        <span className="pb-num ml-auto text-sm text-zinc-600 dark:text-zinc-300">{time ? fmtWhen(time) : ''}</span>
      </div>

      {mode === 'edit' ? (
        <div className="mt-2 space-y-2">
          <Textarea rows={5} autoFocus value={text} onChange={(e) => setText(e.target.value)} className="text-[14px]" />
          <div className="flex items-center gap-2">
            <Button size="sm" variant="primary" disabled={len > limit} onClick={async () => { await onAct(url, { action: 'edit', text }, 'Saved.'); setMode('view'); }}>Save</Button>
            <Button size="sm" variant="ghost" onClick={() => { setText(d.final_text); setMode('view'); }}>Cancel</Button>
            <span className={cn('pb-num ml-auto text-xs', len > limit ? 'font-semibold text-red-600' : 'text-zinc-400')}>{len}/{limit}</span>
          </div>
        </div>
      ) : (
        <PostBody text={d.final_text} className="mt-2 text-[14px] leading-snug text-zinc-800 dark:text-zinc-200" />
      )}

      {d.last_error ? (
        <p className="mt-2 flex gap-1.5 text-[13px] text-red-700 dark:text-red-400"><AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />{d.last_error}</p>
      ) : null}

      {mode === 'time' ? (
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <Input type="datetime-local" className="h-8 w-56" value={when} onChange={(e) => setWhen(e.target.value)} />
          <Button size="sm" variant="primary" onClick={async () => { await onAct(url, { action: 'reschedule', at: new Date(when).toISOString() }, 'Time changed.'); setMode('view'); }}>Save time</Button>
          <Button size="sm" variant="ghost" onClick={() => setMode('view')}>Cancel</Button>
        </div>
      ) : null}

      <div className="mt-2 flex flex-wrap items-center gap-1">
        {changeable && mode === 'view' ? (
          <>
            <Button size="sm" variant="secondary" onClick={() => setMode('edit')}>Edit text</Button>
            <Button size="sm" variant="secondary" onClick={() => setMode('time')}>Change time</Button>
            <Button size="sm" variant="secondary" onClick={() => onAct(url, { action: 'send_now' }, 'Posting now.')}>Post now</Button>
            <Button size="sm" variant="ghost" className="ml-auto text-red-600" onClick={() => onAct(url, { action: 'cancel' }, `Removed from ${PUBLISH_PLATFORM_LABELS[d.platform]}.`)}>Don&apos;t post here</Button>
          </>
        ) : null}
        {d.post_url ? (
          <a href={d.post_url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-sm text-accent-700 hover:underline dark:text-accent-400">
            View on {PUBLISH_PLATFORM_LABELS[d.platform]} <ExternalLink className="h-3.5 w-3.5" />
          </a>
        ) : null}
        {d.provider === 'mock' && d.status === 'sent' ? <span className="text-[11px] text-zinc-400">Test mode: not actually posted</span> : null}
      </div>
    </div>
  );
}
