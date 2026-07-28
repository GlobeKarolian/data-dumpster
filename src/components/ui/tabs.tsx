'use client';

import * as React from 'react';
import { cn } from '@/lib/utils';

export interface TabItem {
  id: string;
  label: React.ReactNode;
  count?: number;
}

export interface TabsProps {
  items: TabItem[];
  value: string;
  onChange: (id: string) => void;
  className?: string;
  /** Accessible name for the tab list. */
  label: string;
}

export function Tabs({ items, value, onChange, className, label }: TabsProps) {
  const onKeyDown = (e: React.KeyboardEvent) => {
    const i = items.findIndex((t) => t.id === value);
    if (e.key === 'ArrowRight') onChange(items[(i + 1) % items.length].id);
    if (e.key === 'ArrowLeft') onChange(items[(i - 1 + items.length) % items.length].id);
  };

  return (
    <div
      role="tablist"
      aria-label={label}
      onKeyDown={onKeyDown}
      className={cn('flex items-center gap-0.5 border-b border-zinc-200 dark:border-zinc-800', className)}
    >
      {items.map((t) => {
        const active = t.id === value;
        return (
          <button
            key={t.id}
            role="tab"
            type="button"
            aria-selected={active}
            tabIndex={active ? 0 : -1}
            onClick={() => onChange(t.id)}
            className={cn(
              'relative -mb-px inline-flex items-center gap-1.5 border-b-2 px-3 py-2 text-xs font-medium transition-colors',
              active
                ? 'border-accent-600 text-zinc-900 dark:text-zinc-100'
                : 'border-transparent text-zinc-500 hover:text-zinc-800 dark:text-zinc-400 dark:hover:text-zinc-200',
            )}
          >
            {t.label}
            {typeof t.count === 'number' ? (
              <span
                className={cn(
                  'pb-num rounded px-1 text-[10px]',
                  active
                    ? 'bg-accent-600/10 text-accent-700 dark:text-accent-400'
                    : 'bg-zinc-100 text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400',
                )}
              >
                {t.count}
              </span>
            ) : null}
          </button>
        );
      })}
    </div>
  );
}

export function TabPanel({
  id,
  active,
  children,
}: {
  id: string;
  active: boolean;
  children: React.ReactNode;
}) {
  if (!active) return null;
  return (
    <div role="tabpanel" id={id} tabIndex={0}>
      {children}
    </div>
  );
}
