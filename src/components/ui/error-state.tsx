'use client';

import * as React from 'react';
import { AlertTriangle, RotateCw } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from './button';

export interface ErrorStateProps {
  title?: string;
  /** The real message. Hiding it makes a data tool harder to trust, not easier. */
  message?: string | null;
  /** Digest or correlation id, shown small so it can be quoted in a bug report. */
  detail?: string | null;
  onRetry?: () => void;
  compact?: boolean;
  className?: string;
}

export function ErrorState({
  title = 'This panel could not load',
  message,
  detail,
  onRetry,
  compact,
  className,
}: ErrorStateProps) {
  return (
    <div
      role="alert"
      className={cn(
        'flex flex-col items-center justify-center text-center',
        compact ? 'px-4 py-8' : 'px-6 py-14',
        className,
      )}
    >
      <span className="mb-3 inline-flex h-9 w-9 items-center justify-center rounded-lg bg-red-500/10 text-red-600 dark:text-red-400">
        <AlertTriangle className="h-4.5 w-4.5" strokeWidth={1.75} aria-hidden />
      </span>
      <h3 className="text-sm font-semibold tracking-tight text-zinc-900 dark:text-zinc-100">{title}</h3>
      <p className="mt-1.5 max-w-md text-xs leading-relaxed text-zinc-500 dark:text-zinc-400">
        {message ||
          'The query behind this panel failed. Nothing partial has been rendered, because half a number is worse than none.'}
      </p>
      {detail ? (
        <code className="pb-num mt-3 rounded bg-zinc-100 px-2 py-1 text-[10px] text-zinc-500 dark:bg-zinc-800 dark:text-zinc-500">
          {detail}
        </code>
      ) : null}
      {onRetry ? (
        <Button size="sm" className="mt-4" onClick={onRetry}>
          <RotateCw className="h-3.5 w-3.5" aria-hidden />
          Try again
        </Button>
      ) : null}
    </div>
  );
}
