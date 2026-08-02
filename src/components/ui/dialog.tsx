'use client';

import * as React from 'react';
import { createPortal } from 'react-dom';
import { cn } from '@/lib/utils';

export interface DialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  labelledBy: string;
  describedBy?: string;
  className?: string;
  children: React.ReactNode;
}

const FOCUSABLE = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',');

/**
 * Controlled modal dialog.
 *
 * It portals past sticky/blurred shell ancestors, makes the rest of the page
 * inert to keyboard navigation through a focus trap, locks page scrolling, and
 * returns focus to the exact row or card that opened it.
 */
export function Dialog({
  open,
  onOpenChange,
  labelledBy,
  describedBy,
  className,
  children,
}: DialogProps) {
  const panelRef = React.useRef<HTMLDivElement>(null);
  const overlayRef = React.useRef<HTMLDivElement>(null);
  const onOpenChangeRef = React.useRef(onOpenChange);
  React.useEffect(() => {
    onOpenChangeRef.current = onOpenChange;
  }, [onOpenChange]);

  const mounted = React.useSyncExternalStore(
    () => () => {},
    () => true,
    () => false,
  );

  React.useEffect(() => {
    if (!open) return;
    const previouslyFocused =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    const overlay = overlayRef.current;
    const background = Array.from(document.body.children)
      .filter((element): element is HTMLElement =>
        element instanceof HTMLElement && element !== overlay)
      .map((element) => ({
        element,
        hadInert: element.hasAttribute('inert'),
        ariaHidden: element.getAttribute('aria-hidden'),
      }));
    for (const item of background) {
      item.element.setAttribute('inert', '');
      item.element.setAttribute('aria-hidden', 'true');
    }

    const focusFrame = window.requestAnimationFrame(() => {
      const panel = panelRef.current;
      if (!panel) return;
      const initial = panel.querySelector<HTMLElement>('[data-dialog-initial-focus]');
      (initial ?? panel).focus();
    });

    const onKeyDown = (event: KeyboardEvent) => {
      const panel = panelRef.current;
      if (!panel) return;
      if (event.key === 'Escape') {
        event.preventDefault();
        onOpenChangeRef.current(false);
        return;
      }
      if (event.key !== 'Tab') return;

      const focusable = Array.from(panel.querySelectorAll<HTMLElement>(FOCUSABLE))
        .filter((element) =>
          !element.hasAttribute('disabled')
          && element.getAttribute('aria-hidden') !== 'true'
          && element.offsetParent !== null);
      if (focusable.length === 0) {
        event.preventDefault();
        panel.focus();
        return;
      }

      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      const active = document.activeElement;
      if (event.shiftKey && (active === first || !panel.contains(active))) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && active === last) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener('keydown', onKeyDown);
    return () => {
      window.cancelAnimationFrame(focusFrame);
      document.removeEventListener('keydown', onKeyDown);
      document.body.style.overflow = previousOverflow;
      for (const item of background) {
        if (!item.hadInert) item.element.removeAttribute('inert');
        if (item.ariaHidden === null) item.element.removeAttribute('aria-hidden');
        else item.element.setAttribute('aria-hidden', item.ariaHidden);
      }
      previouslyFocused?.focus();
    };
  }, [open]);

  if (!mounted || !open) return null;

  return createPortal(
    <div
      ref={overlayRef}
      className="fixed inset-0 z-[70] flex items-center justify-center bg-zinc-950/55 p-3 backdrop-blur-[2px] sm:p-6"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onOpenChangeRef.current(false);
      }}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={labelledBy}
        aria-describedby={describedBy}
        tabIndex={-1}
        className={cn(
          'max-h-[calc(100dvh-1.5rem)] w-full max-w-6xl overflow-hidden rounded-xl border border-zinc-200',
          'bg-white text-zinc-900 shadow-2xl outline-none dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-100',
          'sm:max-h-[calc(100dvh-3rem)]',
          className,
        )}
      >
        {children}
      </div>
    </div>,
    document.body,
  );
}
