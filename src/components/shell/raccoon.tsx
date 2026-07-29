import * as React from 'react';
import { cn } from '@/lib/utils';

/**
 * The raccoon.
 *
 * Every empty state in an analytics tool says some version of "no data yet",
 * which is the least interesting sentence in software. A raccoon peering over
 * the rim of the dumpster says the same thing and makes someone smile on the
 * one screen they hit when something has gone wrong.
 *
 * Drawn to read at 48px: heavy mask, round ears, no detail under 1.5 units.
 * Uses currentColor throughout so it inherits whatever muted tone the empty
 * state is already using and never fights the palette.
 */
export function Raccoon({
  className,
  title = 'A raccoon, rummaging',
}: {
  className?: string;
  title?: string;
}) {
  return (
    <svg
      viewBox="0 0 64 48"
      role="img"
      aria-label={title}
      className={cn('h-12 w-16', className)}
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
    >
      <g fill="currentColor">
        {/* Ears */}
        <circle cx="22.5" cy="12.5" r="5.2" opacity="0.85" />
        <circle cx="41.5" cy="12.5" r="5.2" opacity="0.85" />
        <circle cx="22.5" cy="12.8" r="2.6" opacity="0.35" />
        <circle cx="41.5" cy="12.8" r="2.6" opacity="0.35" />

        {/* Head */}
        <path
          d="M32 6c9.2 0 15.4 6.1 15.4 14.2 0 5.1-1.9 9.1-5 11.6H21.6c-3.1-2.5-5-6.5-5-11.6C16.6 12.1 22.8 6 32 6Z"
          opacity="0.9"
        />

        {/* Bandit mask: the whole read of the animal at small size. */}
        <path
          d="M24.4 18.4c2.6-1.5 5.2-1.5 6.4.2.5.7.7 1.6.6 2.5-.2 2.3-2.2 4.1-4.6 4.1-2.5 0-4.4-1.8-4.4-4 0-1.2.7-2.2 2-2.8Z"
        />
        <path
          d="M39.6 18.4c-2.6-1.5-5.2-1.5-6.4.2-.5.7-.7 1.6-.6 2.5.2 2.3 2.2 4.1 4.6 4.1 2.5 0 4.4-1.8 4.4-4 0-1.2-.7-2.2-2-2.8Z"
        />

        {/* Eyes, sitting inside the mask */}
        <circle cx="27" cy="20.6" r="1.55" fill="var(--pb-raccoon-eye, #ffffff)" />
        <circle cx="37" cy="20.6" r="1.55" fill="var(--pb-raccoon-eye, #ffffff)" />

        {/* Snout and nose */}
        <path d="M32 25.4c2.4 0 4 1.4 4 3.1 0 1.9-1.8 3.3-4 3.3s-4-1.4-4-3.3c0-1.7 1.6-3.1 4-3.1Z" opacity="0.45" />
        <ellipse cx="32" cy="27.4" rx="1.9" ry="1.4" />

        {/* Two paws gripping the rim */}
        <rect x="17.5" y="33.5" width="6.4" height="3.6" rx="1.8" />
        <rect x="40.1" y="33.5" width="6.4" height="3.6" rx="1.8" />

        {/* The rim itself, so he is clearly climbing out of something */}
        <rect x="4" y="36.6" width="56" height="5.2" rx="1.6" opacity="0.55" />
        <path d="M8.6 43.4h46.8l-1.2 3.6a1 1 0 0 1-.95.7H10.75a1 1 0 0 1-.95-.7Z" opacity="0.32" />
      </g>
    </svg>
  );
}
