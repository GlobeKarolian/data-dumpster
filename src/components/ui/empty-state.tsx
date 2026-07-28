import * as React from 'react';
import Link from 'next/link';
import { cn } from '@/lib/utils';

export interface EmptyStateProps {
  /** A lucide icon component, passed uninstantiated. */
  icon?: React.ComponentType<{ className?: string; strokeWidth?: number }>;
  title: string;
  /** Say what is missing and what to do about it. Never just "No data". */
  description: React.ReactNode;
  action?: { label: string; href: string };
  secondaryAction?: { label: string; href: string };
  /** Renders inside a chart or card body rather than as a full page block. */
  compact?: boolean;
  className?: string;
  children?: React.ReactNode;
}

/**
 * The zero-data state.
 *
 * Pressbox will be seen for the first time with an empty database, so this
 * component decides whether the product reads as unfinished or as waiting. It
 * always names the thing that is missing and offers the next action.
 */
export function EmptyState({
  icon: Icon,
  title,
  description,
  action,
  secondaryAction,
  compact,
  className,
  children,
}: EmptyStateProps) {
  return (
    <div
      className={cn(
        'flex flex-col items-center justify-center text-center',
        compact ? 'px-4 py-10' : 'px-6 py-16',
        className,
      )}
    >
      {Icon ? (
        <span
          className={cn(
            'mb-3 inline-flex items-center justify-center rounded-lg border border-zinc-200 bg-zinc-50 text-zinc-400',
            'dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-600',
            compact ? 'h-8 w-8' : 'h-10 w-10',
          )}
        >
          <Icon className={compact ? 'h-4 w-4' : 'h-5 w-5'} strokeWidth={1.75} />
        </span>
      ) : null}
      <h3
        className={cn(
          'font-semibold tracking-tight text-zinc-900 dark:text-zinc-100',
          compact ? 'text-sm' : 'text-base',
        )}
      >
        {title}
      </h3>
      <div
        className={cn(
          'mt-1.5 max-w-md text-zinc-500 dark:text-zinc-400',
          compact ? 'text-xs leading-relaxed' : 'text-sm leading-relaxed',
        )}
      >
        {description}
      </div>
      {action || secondaryAction ? (
        <div className="mt-5 flex flex-wrap items-center justify-center gap-2">
          {action ? (
            <Link
              href={action.href}
              className="inline-flex h-8 items-center rounded-md bg-accent-600 px-3 text-xs font-medium text-white transition-colors hover:bg-accent-700"
            >
              {action.label}
            </Link>
          ) : null}
          {secondaryAction ? (
            <Link
              href={secondaryAction.href}
              className="inline-flex h-8 items-center rounded-md border border-zinc-200 px-3 text-xs font-medium text-zinc-700 transition-colors hover:bg-zinc-100 dark:border-zinc-800 dark:text-zinc-300 dark:hover:bg-zinc-800"
            >
              {secondaryAction.label}
            </Link>
          ) : null}
        </div>
      ) : null}
      {children ? <div className="mt-5">{children}</div> : null}
    </div>
  );
}
