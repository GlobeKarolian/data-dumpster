'use client';

import * as React from 'react';
import { createPortal } from 'react-dom';
import { cn } from '@/lib/utils';
import { calculatePopoverPosition, type PopoverPosition } from './popover-position';

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
  const [position, setPosition] = React.useState<PopoverPosition | null>(null);
  const rootRef = React.useRef<HTMLDivElement>(null);
  const triggerRef = React.useRef<HTMLButtonElement>(null);
  const panelRef = React.useRef<HTMLDivElement>(null);
  const panelId = React.useId();

  const close = React.useCallback(() => setOpen(false), []);

  const updatePosition = React.useCallback(() => {
    const root = rootRef.current;
    const panel = panelRef.current;
    if (!root || !panel) return;
    setPosition(calculatePopoverPosition({
      trigger: root.getBoundingClientRect(),
      panel: panel.getBoundingClientRect(),
      viewportWidth: window.innerWidth,
      viewportHeight: window.innerHeight,
      align,
    }));
  }, [align]);

  React.useLayoutEffect(() => {
    if (!open) return;
    updatePosition();
    const frame = window.requestAnimationFrame(updatePosition);
    const observer = typeof ResizeObserver === 'undefined'
      ? null
      : new ResizeObserver(updatePosition);
    if (rootRef.current) observer?.observe(rootRef.current);
    if (panelRef.current) observer?.observe(panelRef.current);
    window.addEventListener('resize', updatePosition);
    window.addEventListener('scroll', updatePosition, true);
    return () => {
      window.cancelAnimationFrame(frame);
      observer?.disconnect();
      window.removeEventListener('resize', updatePosition);
      window.removeEventListener('scroll', updatePosition, true);
    };
  }, [open, updatePosition]);

  React.useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      const target = e.target as Node;
      if (!rootRef.current?.contains(target) && !panelRef.current?.contains(target)) close();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        close();
        triggerRef.current?.focus();
      }
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [close, open]);

  const panel = open && typeof document !== 'undefined'
    ? createPortal(
        <div
          ref={panelRef}
          id={panelId}
          role="dialog"
          aria-label={label}
          style={{
            top: position?.top ?? 0,
            left: position?.left ?? 0,
            visibility: position ? 'visible' : 'hidden',
            maxWidth: 'calc(100vw - 1rem)',
            maxHeight: 'calc(100vh - 1rem)',
          }}
          className={cn(
            'fixed z-[110] min-w-56 overflow-y-auto rounded-lg border border-zinc-200 bg-white shadow-xl',
            'dark:border-zinc-700 dark:bg-zinc-900',
            panelClassName,
          )}
        >
          {children({ close })}
        </div>,
        document.body,
      )
    : null;

  return (
    <div ref={rootRef} className={cn('relative', className)}>
      <button
        ref={triggerRef}
        type="button"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={open ? panelId : undefined}
        aria-label={label}
        onClick={() => {
          setPosition(null);
          setOpen((value) => !value);
        }}
        className="inline-flex w-full items-center"
      >
        {trigger({ open })}
      </button>
      {panel}
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
        'inline-flex h-9 w-full items-center gap-2 rounded-md border px-2.5 text-sm transition-colors max-sm:h-11',
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
