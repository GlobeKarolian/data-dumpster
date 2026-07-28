'use client';

import * as React from 'react';
import { AlertTriangle, RotateCw } from 'lucide-react';

export default function AppError({
  error,
  unstable_retry,
}: {
  error: Error & { digest?: string };
  unstable_retry: () => void;
}) {
  React.useEffect(() => {
    console.error('[pressbox] screen failed to render:', error);
  }, [error]);

  return (
    <div className="flex min-h-[60vh] items-center justify-center px-6">
      <div className="max-w-md text-center">
        <span className="mx-auto mb-4 flex h-10 w-10 items-center justify-center rounded-lg bg-red-500/10 text-red-600 dark:text-red-400">
          <AlertTriangle className="h-5 w-5" strokeWidth={1.75} aria-hidden />
        </span>
        <h2 className="text-base font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
          This screen could not be rendered
        </h2>
        <p className="mt-2 text-sm leading-relaxed text-zinc-600 dark:text-zinc-400">
          Nothing partial has been shown, because a half-computed comparison is worse than none.
          The underlying error was:
        </p>
        <p className="mt-3 rounded-md border border-zinc-200 bg-zinc-50 px-3 py-2 text-left text-xs leading-relaxed text-zinc-700 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-300">
          {error.message || 'No message was attached to the error.'}
        </p>
        {error.digest ? (
          <code className="pb-num mt-2 block text-[10px] text-zinc-400">{'digest ' + error.digest}</code>
        ) : null}
        <button
          type="button"
          onClick={unstable_retry}
          className="mt-5 inline-flex h-9 items-center gap-2 rounded-md bg-accent-600 px-3 text-sm font-medium text-white transition-colors hover:bg-accent-700"
        >
          <RotateCw className="h-3.5 w-3.5" aria-hidden />
          Try again
        </button>
      </div>
    </div>
  );
}
