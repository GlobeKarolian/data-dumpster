import * as React from 'react';
import { PLATFORM_COLORS, PLATFORM_LABELS, type Platform } from '@/lib/types';
import { cn } from '@/lib/utils';

type Tone = 'neutral' | 'accent' | 'positive' | 'warning' | 'critical' | 'outline';

const TONES: Record<Tone, string> = {
  neutral: 'bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300',
  accent: 'bg-accent-600/10 text-accent-700 dark:bg-accent-600/15 dark:text-accent-400',
  positive: 'bg-emerald-500/10 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-400',
  warning: 'bg-amber-500/10 text-amber-700 dark:bg-amber-500/15 dark:text-amber-400',
  critical: 'bg-red-500/10 text-red-700 dark:bg-red-500/15 dark:text-red-400',
  outline: 'border border-zinc-200 text-zinc-600 dark:border-zinc-700 dark:text-zinc-400',
};

export function Badge({
  className,
  tone = 'neutral',
  ...props
}: React.ComponentProps<'span'> & { tone?: Tone }) {
  return (
    <span
      {...props}
      className={cn(
        'inline-flex shrink-0 items-center gap-1 rounded px-1.5 py-0.5 text-[11px] font-medium leading-4',
        TONES[tone],
        className,
      )}
    />
  );
}

/** A platform chip that carries the platform's own brand color as a dot. */
export function PlatformBadge({
  platform,
  showLabel = true,
  className,
}: {
  platform: Platform;
  showLabel?: boolean;
  className?: string;
}) {
  return (
    <span
      className={cn(
        'inline-flex shrink-0 items-center gap-1.5 text-xs text-zinc-600 dark:text-zinc-400',
        className,
      )}
      title={PLATFORM_LABELS[platform]}
    >
      <span
        aria-hidden
        className="h-2 w-2 shrink-0 rounded-full ring-1 ring-inset ring-black/10 dark:ring-white/15"
        style={{ backgroundColor: PLATFORM_COLORS[platform] }}
      />
      {showLabel ? PLATFORM_LABELS[platform] : <span className="sr-only">{PLATFORM_LABELS[platform]}</span>}
    </span>
  );
}

/** A colored dot used for company series and health indicators. */
export function Dot({
  color,
  pulse,
  className,
}: {
  color: string;
  pulse?: boolean;
  className?: string;
}) {
  return (
    <span className={cn('relative inline-flex h-2 w-2 shrink-0', className)} aria-hidden>
      {pulse ? (
        <span
          className="absolute inset-0 animate-ping rounded-full opacity-60"
          style={{ backgroundColor: color }}
        />
      ) : null}
      <span className="relative h-2 w-2 rounded-full" style={{ backgroundColor: color }} />
    </span>
  );
}
