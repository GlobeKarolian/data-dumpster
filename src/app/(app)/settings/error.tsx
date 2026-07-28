'use client';

import * as React from 'react';
import { AlertTriangle } from 'lucide-react';

export default function SettingsError({
  error,
  unstable_retry,
}: {
  error: Error & { digest?: string };
  unstable_retry: () => void;
}) {
  React.useEffect(() => {
    console.error('[pressbox] settings screen failed:', error);
  }, [error]);

  return (
    <div className="mx-auto max-w-xl py-16 text-center">
      <span className="mx-auto mb-4 flex h-10 w-10 items-center justify-center rounded-lg bg-red-500/10 text-red-600 dark:text-red-400">
        <AlertTriangle className="h-5 w-5" strokeWidth={1.75} aria-hidden />
      </span>
      <h2 className="text-base font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
        Settings could not be loaded
      </h2>
      <p className="mt-2 text-sm leading-relaxed text-zinc-600 dark:text-zinc-400">
        {error.message || 'The settings query failed without a message.'}
      </p>
      <button
        type="button"
        onClick={unstable_retry}
        className="mt-5 inline-flex h-9 items-center rounded-md bg-accent-600 px-3 text-sm font-medium text-white transition-colors hover:bg-accent-700"
      >
        Try again
      </button>
    </div>
  );
}
