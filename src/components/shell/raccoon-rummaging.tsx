'use client';

import * as React from 'react';
import { cn } from '@/lib/utils';

/**
 * The raccoon, working.
 *
 * A refresh takes one to five minutes because vendor calls are slow, and a
 * spinner for five minutes reads as a hang. This is the same raccoon from the
 * empty states, animated: he ducks into the dumpster, roots around, and comes
 * back up with something. It is honest about the wait in a way a spinner is
 * not, and it is the one place the product's name earns itself.
 *
 * SVG and CSS rather than a GIF: sharp at any size, a few hundred bytes,
 * inherits currentColor so dark mode needs no second asset, and it respects
 * prefers-reduced-motion, which a GIF cannot.
 */
export function RaccoonRummaging({
  className,
  title = 'A raccoon rummaging in the dumpster',
}: {
  className?: string;
  title?: string;
}) {
  return (
    <span className={cn('inline-block', className)}>
      <style>{`
        @keyframes pb-dive {
          0%, 12%   { transform: translateY(0) rotate(0deg); }
          22%, 46%  { transform: translateY(9px) rotate(-4deg); }
          56%       { transform: translateY(-1px) rotate(3deg); }
          68%, 88%  { transform: translateY(0) rotate(0deg); }
          100%      { transform: translateY(0) rotate(0deg); }
        }
        @keyframes pb-loot {
          0%, 50%  { opacity: 0; transform: translateY(4px) scale(0.6); }
          62%, 84% { opacity: 1; transform: translateY(-3px) scale(1); }
          96%,100% { opacity: 0; transform: translateY(-7px) scale(0.9); }
        }
        @keyframes pb-rattle {
          0%,100% { transform: translateX(0); }
          30%     { transform: translateX(-0.6px); }
          60%     { transform: translateX(0.6px); }
        }
        .pb-rc-body { animation: pb-dive 2.6s ease-in-out infinite; transform-origin: 32px 34px; }
        .pb-rc-loot { animation: pb-loot 2.6s ease-in-out infinite; transform-origin: 44px 20px; }
        .pb-rc-bin  { animation: pb-rattle 2.6s ease-in-out infinite; transform-origin: 32px 40px; }
        @media (prefers-reduced-motion: reduce) {
          .pb-rc-body, .pb-rc-loot, .pb-rc-bin { animation: none; }
          .pb-rc-loot { opacity: 1; }
        }
      `}</style>
      <svg viewBox="0 0 64 48" role="img" aria-label={title} className="h-full w-full" fill="none">
        <g fill="currentColor">
          <g className="pb-rc-body">
            <circle cx="22.5" cy="12.5" r="5.2" opacity="0.85" />
            <circle cx="41.5" cy="12.5" r="5.2" opacity="0.85" />
            <circle cx="22.5" cy="12.8" r="2.6" opacity="0.35" />
            <circle cx="41.5" cy="12.8" r="2.6" opacity="0.35" />
            <path
              d="M32 6c9.2 0 15.4 6.1 15.4 14.2 0 5.1-1.9 9.1-5 11.6H21.6c-3.1-2.5-5-6.5-5-11.6C16.6 12.1 22.8 6 32 6Z"
              opacity="0.9"
            />
            <path d="M24.4 18.4c2.6-1.5 5.2-1.5 6.4.2.5.7.7 1.6.6 2.5-.2 2.3-2.2 4.1-4.6 4.1-2.5 0-4.4-1.8-4.4-4 0-1.2.7-2.2 2-2.8Z" />
            <path d="M39.6 18.4c-2.6-1.5-5.2-1.5-6.4.2-.5.7-.7 1.6-.6 2.5.2 2.3 2.2 4.1 4.6 4.1 2.5 0 4.4-1.8 4.4-4 0-1.2-.7-2.2-2-2.8Z" />
            <circle cx="27" cy="20.6" r="1.55" fill="#fff" />
            <circle cx="37" cy="20.6" r="1.55" fill="#fff" />
            <path d="M32 25.4c2.4 0 4 1.4 4 3.1 0 1.9-1.8 3.3-4 3.3s-4-1.4-4-3.3c0-1.7 1.6-3.1 4-3.1Z" opacity="0.45" />
            <ellipse cx="32" cy="27.4" rx="1.9" ry="1.4" />
            <rect x="17.5" y="33.5" width="6.4" height="3.6" rx="1.8" />
            <rect x="40.1" y="33.5" width="6.4" height="3.6" rx="1.8" />
          </g>

          <g className="pb-rc-loot" opacity="0">
            <rect x="46.5" y="15" width="7.5" height="5.5" rx="1" opacity="0.9" />
            <rect x="48" y="12.4" width="4.5" height="2.6" rx="0.8" opacity="0.55" />
          </g>

          <g className="pb-rc-bin">
            <rect x="4" y="36.6" width="56" height="5.2" rx="1.6" opacity="0.6" />
            <path d="M8.6 43.4h46.8l-1.2 3.6a1 1 0 0 1-.95.7H10.75a1 1 0 0 1-.95-.7Z" opacity="0.35" />
          </g>
        </g>
      </svg>
    </span>
  );
}
