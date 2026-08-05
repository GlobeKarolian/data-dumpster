import * as React from 'react';
import { cn } from '@/lib/utils';

/**
 * The single surface primitive. Everything in Data Dumpster that holds data sits in
 * one of these: a hairline border, no shadow, no rounded-corner theatrics.
 */
export function Card({ className, ...props }: React.ComponentProps<'section'>) {
  return (
    <section
      {...props}
      className={cn(
        'min-w-0 max-w-full rounded-lg border border-zinc-200 bg-white',
        'dark:border-zinc-800 dark:bg-zinc-900/40',
        className,
      )}
    />
  );
}

export function CardHeader({ className, ...props }: React.ComponentProps<'header'>) {
  return (
    <header
      {...props}
      className={cn(
        'flex min-h-[3.25rem] flex-wrap items-center justify-between gap-3 border-b border-zinc-200 px-4 py-3',
        'dark:border-zinc-800',
        className,
      )}
    />
  );
}

export function CardTitle({ className, ...props }: React.ComponentProps<'h2'>) {
  return (
    <h2
      {...props}
      className={cn('text-sm font-semibold tracking-tight text-zinc-900 dark:text-zinc-100', className)}
    />
  );
}

export function CardDescription({ className, ...props }: React.ComponentProps<'p'>) {
  return <p {...props} className={cn('text-xs text-zinc-500 dark:text-zinc-400', className)} />;
}

export function CardToolbar({ className, ...props }: React.ComponentProps<'div'>) {
  return <div {...props} className={cn('flex shrink-0 items-center gap-2', className)} />;
}

export function CardBody({ className, ...props }: React.ComponentProps<'div'>) {
  return <div {...props} className={cn('p-4', className)} />;
}

export function CardFooter({ className, ...props }: React.ComponentProps<'footer'>) {
  return (
    <footer
      {...props}
      className={cn(
        'flex items-center justify-between gap-3 border-t border-zinc-200 px-4 py-2.5 text-xs text-zinc-500',
        'dark:border-zinc-800 dark:text-zinc-400',
        className,
      )}
    />
  );
}

/** A one-line note under a chart, used for caveats and denominators. */
export function CardNote({ className, ...props }: React.ComponentProps<'p'>) {
  return (
    <p
      {...props}
      className={cn(
        'border-t border-zinc-200 px-4 py-2 text-[11px] leading-relaxed text-zinc-500',
        'dark:border-zinc-800 dark:text-zinc-500',
        className,
      )}
    />
  );
}
