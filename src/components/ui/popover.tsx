'use client';

import * as React from 'react';
import { cn } from '@/lib/utils';

export interface PopoverProps {
  /** The clickable trigger. Receives open state so it can show a chevron. */
  trigger: (state: { open: boolean }) => React.ReactNode;
  children: (state: { close: () => void }) => React.ReactNode;
  align?: 'start' | 'end';
  className?: string;
  panelClassName?: string;
  /** Accessible name for the disclosure. */
  label: string;
}

/**
 * Click-to-open panel with outside-click and Escape dismissal. Deliberately
 * unstyled inside: callers own the panel contents.
 */
export function Popover({ trigger, children, align = 'start', className, panelClassName, label }: PopoverProps) {
  const [open, setOpen] = React.useState(false);
  const ref = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  return (
    <div ref={ref} className={cn('relative', className)}>
      <button
        type="button"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={label}
        onClick={() => setOpen((v) => !v)}
        className="inline-flex w-full items-center"
      >
        {trigger({ open })}
      </button>
      {open ? (
        <div
          role="dialog"
          aria-label={label}
          className={cn(
            'absolute z-40 mt-1.5 min-w-56 rounded-lg border border-zinc-200 bg-white shadow-xl',
            'dark:border-zinc-700 dark:bg-zinc-900',
            align === 'end' ? 'right-0' : 'left-0',
            panelClassName,
          )}
        >
          {children({ close: () => setOpen(false) })}
        </div>
      ) : null}
    </div>
  );
}

/** Standard trigger surface so popovers across the app look identical. */
export function PopoverTriggerSurface({
  className,
  children,
  open,
}: {
  className?: string;
  children: React.ReactNode;
  open?: boolean;
}) {
  return (
    <span
      className={cn(
        'inline-flex h-9 w-full items-center gap-2 rounded-md border px-2.5 text-sm transition-colors',
        'border-zinc-200 bg-white text-zinc-700 hover:bg-zinc-50',
        'dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-200 dark:hover:bg-zinc-800',
        open && 'border-accent-600 dark:border-accent-500',
        className,
      )}
    >
      {children}
    </span>
  );
}
