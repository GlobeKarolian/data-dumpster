'use client';

import * as React from 'react';
import Image from 'next/image';
import { ExternalLink } from 'lucide-react';
import { cn } from '@/lib/utils';

/**
 * Creed Bratton, The Office's resident thief, from the show's official GIPHY
 * channel. Article Leakage's mascot for people lifting free copies. Shown with
 * GIPHY credit (as on the login hero), and as a still for anyone who prefers
 * reduced motion.
 */
const GIF = 'https://media.giphy.com/media/DWxKllu8w3ZxmFU4zN/giphy.gif';
const STILL = 'https://media.giphy.com/media/DWxKllu8w3ZxmFU4zN/giphy_s.gif';
const SOURCE = 'https://giphy.com/gifs/theoffice-the-office-tv-casino-night-DWxKllu8w3ZxmFU4zN';

export function CreedGif({ size = 160, credit = true, className }: { size?: number; credit?: boolean; className?: string }) {
  const height = Math.round((size * 400) / 480);
  return (
    <div className={cn('relative shrink-0 overflow-hidden rounded-lg bg-zinc-900', className)} style={{ width: size, height }}>
      {/* Eager, like the login hero: lazy loading left a black box in background tabs. */}
      <Image src={GIF} alt="Creed from The Office, the resident thief" fill sizes={size + 'px'} unoptimized loading="eager" className="object-cover motion-reduce:hidden" />
      <Image src={STILL} alt="Creed from The Office, the resident thief" fill sizes={size + 'px'} unoptimized className="hidden object-cover motion-reduce:block" />
      {credit ? (
        <a
          href={SOURCE}
          target="_blank"
          rel="noreferrer"
          className="absolute right-1 bottom-1 inline-flex items-center gap-0.5 rounded bg-black/60 px-1 py-0.5 text-[9px] font-medium text-white/70 transition hover:text-white"
        >
          GIPHY <ExternalLink className="h-2 w-2" aria-hidden />
        </a>
      ) : null}
    </div>
  );
}

/** A still Creed that plays on hover, for the Leaked copies tile. */
export function CreedBadge({ className }: { className?: string }) {
  return (
    <span className={cn('group relative inline-block h-9 w-11 shrink-0 overflow-hidden rounded-md bg-zinc-900', className)} title="Creed approves">
      <Image src={STILL} alt="" fill sizes="44px" unoptimized loading="eager" className="object-cover group-hover:hidden" />
      <Image src={GIF} alt="" fill sizes="44px" unoptimized className="hidden object-cover group-hover:block motion-reduce:!hidden" />
    </span>
  );
}

const SEARCH_LINES = [
  'Searching X for links to the story…',
  'Checking archive.ph, archive.today and friends…',
  'Looking for posts that name it without a link…',
  'Counting who is passing around free copies…',
  'Pulling each account’s public profile…',
];

/** The minute-long wait while X is searched, with rotating status lines. */
export function CreedSearching({ message }: { message: string }) {
  const searching = message.startsWith('Searching');
  const [line, setLine] = React.useState(0);
  React.useEffect(() => {
    if (!searching) return;
    const timer = window.setInterval(() => setLine((i) => (i + 1) % SEARCH_LINES.length), 4000);
    return () => window.clearInterval(timer);
  }, [searching]);
  return (
    <div className="flex items-center gap-4 rounded-lg border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900/40">
      <CreedGif size={120} />
      <div>
        <p className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">{searching ? SEARCH_LINES[line] : message}</p>
        {searching ? <p className="mt-1 text-xs text-zinc-500">This can take up to a minute for a widely shared story.</p> : null}
      </div>
    </div>
  );
}
