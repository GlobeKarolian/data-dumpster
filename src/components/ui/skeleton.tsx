import * as React from 'react';
import { cn } from '@/lib/utils';

export function Skeleton({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      {...props}
      aria-hidden
      className={cn(
        'pb-shimmer relative overflow-hidden rounded bg-zinc-200/70 dark:bg-zinc-800/70',
        className,
      )}
    />
  );
}

export function SkeletonText({ lines = 3, className }: { lines?: number; className?: string }) {
  return (
    <div className={cn('space-y-2', className)}>
      {Array.from({ length: lines }, (_, i) => (
        <Skeleton key={i} className={cn('h-3', i === lines - 1 ? 'w-2/3' : 'w-full')} />
      ))}
    </div>
  );
}

export function SkeletonStatRow({ count = 4 }: { count?: number }) {
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
      {Array.from({ length: count }, (_, i) => (
        <div
          key={i}
          className="rounded-lg border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900/40"
        >
          <Skeleton className="h-3 w-24" />
          <Skeleton className="mt-3 h-7 w-32" />
          <Skeleton className="mt-3 h-8 w-full" />
        </div>
      ))}
    </div>
  );
}

export function SkeletonCard({ height = 'h-64', className }: { height?: string; className?: string }) {
  return (
    <div
      className={cn(
        'rounded-lg border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900/40',
        className,
      )}
    >
      <div className="border-b border-zinc-200 px-4 py-3 dark:border-zinc-800">
        <Skeleton className="h-3.5 w-40" />
      </div>
      <div className="p-4">
        <Skeleton className={cn('w-full', height)} />
      </div>
    </div>
  );
}

export function SkeletonTable({ rows = 8, cols = 5 }: { rows?: number; cols?: number }) {
  return (
    <div className="rounded-lg border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900/40">
      <div className="border-b border-zinc-200 px-4 py-2.5 dark:border-zinc-800">
        <Skeleton className="h-3 w-32" />
      </div>
      <div className="divide-y divide-zinc-100 dark:divide-zinc-800/60">
        {Array.from({ length: rows }, (_, r) => (
          <div key={r} className="flex items-center gap-4 px-4 py-2.5">
            {Array.from({ length: cols }, (_, c) => (
              <Skeleton key={c} className={cn('h-3', c === 0 ? 'w-40 flex-none' : 'flex-1')} />
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}
