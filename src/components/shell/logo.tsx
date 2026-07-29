import * as React from 'react';
import { cn } from '@/lib/utils';

/**
 * The Social Media Data Dumpster.
 *
 * The mark is a dumpster with three bars rising out of it. Read one way they
 * are refuse sticking out of a skip; read the other way they are a bar chart,
 * ascending left to right. That double reading is the whole joke and it is also
 * the product thesis: this is where the garbage goes, and sorting it is how you
 * find out what actually happened.
 *
 * Constraints it has to survive: 20px in a sidebar, one flat colour on a dark
 * background, and a favicon. So no gradients, no strokes under 1.5 units, and
 * every shape closed rather than outlined.
 */
export function DumpsterMark({
  className,
  title = 'Data Dumpster',
}: {
  className?: string;
  title?: string;
}) {
  return (
    <svg
      viewBox="0 0 32 32"
      role="img"
      aria-label={title}
      className={cn('h-6 w-6', className)}
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
    >
      {/* Bars: refuse, or a rising chart. Shortest to tallest, left to right. */}
      <rect x="9.2" y="9.5" width="3.4" height="5.5" rx="0.6" fill="currentColor" opacity="0.55" />
      <rect x="14.3" y="6.2" width="3.4" height="8.8" rx="0.6" fill="currentColor" opacity="0.78" />
      <rect x="19.4" y="2.8" width="3.4" height="12.2" rx="0.6" fill="currentColor" />

      {/* Lip of the dumpster. Sits over the bars so they read as inside it. */}
      <path
        d="M2.6 14.4h26.8a1 1 0 0 1 .98 1.2l-.34 1.7a1 1 0 0 1-.98.8H2.94a1 1 0 0 1-.98-.8l-.34-1.7a1 1 0 0 1 .98-1.2Z"
        fill="currentColor"
      />

      {/* Body: tapered, the way a real skip is. */}
      <path
        d="M4.2 19.1h23.6l-2.1 6.9a1.2 1.2 0 0 1-1.15.85H7.45A1.2 1.2 0 0 1 6.3 26Z"
        fill="currentColor"
        opacity="0.88"
      />

      <circle cx="10.4" cy="28.6" r="1.7" fill="currentColor" />
      <circle cx="21.6" cy="28.6" r="1.7" fill="currentColor" />
    </svg>
  );
}

/** Mark plus wordmark. Used on the sign-in screen and anywhere with room. */
export function DumpsterLogo({
  className,
  compact = false,
}: {
  className?: string;
  compact?: boolean;
}) {
  return (
    <span className={cn('inline-flex items-center gap-2.5', className)}>
      <span className="grid h-8 w-8 shrink-0 place-items-center rounded-md bg-accent-600 text-white">
        <DumpsterMark className="h-5 w-5" />
      </span>
      <span className="min-w-0 leading-tight">
        {compact ? null : (
          <span className="block text-[9px] font-semibold uppercase tracking-[0.18em] text-zinc-400 dark:text-zinc-500">
            Social Media
          </span>
        )}
        <span className="block truncate text-sm font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
          Data Dumpster
        </span>
      </span>
    </span>
  );
}
