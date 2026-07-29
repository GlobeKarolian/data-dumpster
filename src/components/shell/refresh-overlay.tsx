'use client';

import * as React from 'react';
import { X } from 'lucide-react';
import { cn } from '@/lib/utils';

/**
 * Full-screen refresh takeover.
 *
 * A refresh runs one to five minutes because vendor calls take thirty to a
 * hundred seconds each and there are dozens of channels. A spinner for that
 * long reads as a hang, and a user who thinks the app has hung reloads the tab,
 * which does not stop the run and does make them distrust the next one.
 *
 * So the wait is made explicit and given something to look at. The elapsed
 * clock is the honest part: it never pretends to know a percentage, because we
 * genuinely do not know how long a given vendor call will take.
 */
const CAPTIONS = [
  'Rummaging through the bins',
  'Negotiating with the TikTok API',
  'Counting other people\'s likes',
  'Asking Instagram nicely. Again',
  'Sorting recyclables from engagement',
  'Extracting value from garbage',
  'Checking whether anyone posted on Bluesky',
  'Weighing the reels',
  'This is what a data vendor sounds like',
  'Somewhere a scraper is having a worse day',
  'Reading 4,000 captions so you do not have to',
  'The raccoon does not rush',
];

function clock(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return m + ':' + String(s).padStart(2, '0');
}

export function RefreshOverlay({
  elapsed,
  onCancel,
}: {
  elapsed: number;
  onCancel?: () => void;
}) {
  // One caption every eight seconds, derived from elapsed rather than held in
  // state, so there is no second timer to keep in sync with the first.
  const caption = CAPTIONS[Math.floor(elapsed / 8) % CAPTIONS.length];

  React.useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = prev; };
  }, []);

  return (
    <div
      role="status"
      aria-live="polite"
      className={cn(
        'fixed inset-0 z-50 flex flex-col items-center justify-center',
        'bg-white/95 backdrop-blur-sm dark:bg-zinc-950/95',
      )}
    >
      {onCancel ? (
        <button
          type="button"
          onClick={onCancel}
          aria-label="Hide this and let the refresh continue"
          className="absolute right-5 top-5 inline-flex h-8 w-8 items-center justify-center rounded-md text-zinc-400 transition-colors hover:bg-zinc-100 hover:text-zinc-700 dark:hover:bg-zinc-800 dark:hover:text-zinc-200"
        >
          <X className="h-4 w-4" aria-hidden />
        </button>
      ) : null}

      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src="/raccoon.gif"
        alt=""
        width={220}
        height={212}
        className="h-[220px] w-[220px] rounded-full object-cover"
      />

      <p className="mt-7 text-lg font-medium tracking-tight text-zinc-900 dark:text-zinc-50">
        {caption}
      </p>
      <p className="pb-num mt-1.5 text-sm tabular-nums text-zinc-500 dark:text-zinc-400">
        {clock(elapsed)}
      </p>

      <p className="mt-6 max-w-sm px-6 text-center text-xs leading-relaxed text-zinc-500 dark:text-zinc-400">
        Pulling the stalest channels first. Vendor calls take thirty to a hundred seconds each, so
        this runs for a few minutes. You can close this and keep working; the refresh continues.
      </p>
    </div>
  );
}
