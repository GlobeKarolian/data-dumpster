'use client';

import * as React from 'react';
import { PlatformIcon } from '@/components/ui/platform-icon';
import { PUBLISH_PLATFORM_LABELS, type PublishPlatform } from '@/lib/publishing/platforms';
import { cn } from '@/lib/utils';

/** "Main" is how accounts get created; editors think in networks, so show the network. */
export function accountName(t: { platform: PublishPlatform; label: string; handle?: string | null }): string {
  const net = PUBLISH_PLATFORM_LABELS[t.platform];
  if (!t.label || t.label.toLowerCase() === 'main') return net;
  return `${net} · ${t.label}`;
}

/** The scheduler's reasons, in desk language. */
export function friendlyReason(reason: string | null | undefined): string | null {
  if (!reason) return null;
  const r = reason.replace(/^[A-Z][a-z]{2} \d{1,2}(:\d{2})?[ap]m: /, '');
  const m = r.match(/\(([\d.]+)x its typical engagement\)/);
  if (m) return Number(m[1]) >= 1 ? `Best hour · ${m[1]}× usual engagement` : `Quietest acceptable hour · ${m[1]}× usual`;
  if (/earliest allowed time/.test(r)) return 'First open slot';
  if (/next open time/.test(r)) return 'Next open time';
  if (/best spacing/.test(r)) return 'Spaced from other posts';
  if (/Exact time set/.test(r)) return 'Scheduled';
  if (/Sent now by editor/.test(r)) return 'Sent now';
  if (/Moved by editor/.test(r)) return 'Moved';
  return r;
}

export function shortUrl(u: string): string {
  try {
    const url = new URL(u);
    const path = url.pathname.replace(/\/$/, '');
    const host = url.hostname.replace(/^www\./, '');
    return path.length > 28 ? `${host}${path.slice(0, 26)}…` : host + path;
  } catch {
    return u.length > 40 ? u.slice(0, 38) + '…' : u;
  }
}

/** Post text with long tracked URLs collapsed, the way the networks display them. */
export function PostBody({ text, className }: { text: string; className?: string }) {
  const parts = text.split(/(https?:\/\/\S+)/g);
  return (
    <p className={cn('whitespace-pre-wrap break-words', className)}>
      {parts.map((p, i) => (/^https?:\/\//.test(p)
        ? <a key={i} href={p} target="_blank" rel="noreferrer" title={p} className="text-accent-700 hover:underline dark:text-accent-400">{shortUrl(p)}</a>
        : <React.Fragment key={i}>{p}</React.Fragment>))}
    </p>
  );
}

export interface Card { title: string; description?: string; image: string | null }

/** Link card as Facebook, Threads and Bluesky render it. */
export function LinkCard({ card, url, compact }: { card: Card | null | undefined; url: string | null; compact?: boolean }) {
  if (!url) return null;
  return (
    <a href={url} target="_blank" rel="noreferrer"
      className={cn('flex overflow-hidden rounded-lg border border-zinc-200 bg-white hover:border-zinc-300 dark:border-zinc-800 dark:bg-zinc-950',
        compact ? 'items-center' : 'flex-col')}>
      {card?.image ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={card.image} alt="" className={compact ? 'h-14 w-20 shrink-0 object-cover' : 'aspect-[1.91/1] w-full object-cover'} />
      ) : null}
      <span className="min-w-0 px-2.5 py-1.5">
        <span className="block truncate text-[10px] uppercase tracking-wide text-zinc-400">{shortUrl(url).split('/')[0]}</span>
        <span className="line-clamp-2 text-[13px] font-medium leading-snug text-zinc-900 dark:text-zinc-100">{card?.title ?? shortUrl(url)}</span>
      </span>
    </a>
  );
}

/** A small, recognisable mock of how the post will look on its network. */
export function PostMock({ platform, brand, text, linkUrl, linkMode, card, image }: {
  platform: PublishPlatform; brand: string; text: string; linkUrl: string | null;
  linkMode: 'card' | 'text' | 'none'; card: Card | null | undefined; image: string | null;
}) {
  const visual = platform === 'instagram' || platform === 'tiktok';
  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <span className="grid h-7 w-7 place-items-center rounded-full bg-zinc-900 text-[11px] font-bold text-white dark:bg-zinc-100 dark:text-zinc-900">
          {brand.replace(/[^A-Za-z]/g, '').slice(0, 1).toUpperCase() || 'B'}
        </span>
        <span className="text-[13px] font-semibold">{brand}</span>
        <PlatformIcon platform={platform} className="ml-auto" />
      </div>
      {visual ? (
        image
          // eslint-disable-next-line @next/next/no-img-element
          ? <img src={image} alt="" className="aspect-square w-full rounded-md object-cover" />
          : <div className="grid aspect-square w-full place-items-center rounded-md bg-zinc-100 text-xs text-zinc-400 dark:bg-zinc-900">Needs an image</div>
      ) : null}
      {text ? <PostBody text={text} className="text-[13px] leading-snug text-zinc-800 dark:text-zinc-200" /> : null}
      {!visual && linkUrl && linkMode !== 'none' ? <LinkCard card={card} url={linkUrl} compact /> : null}
    </div>
  );
}
