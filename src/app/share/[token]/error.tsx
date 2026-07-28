'use client';

import * as React from 'react';

export default function ShareError({ error }: { error: Error & { digest?: string } }) {
  React.useEffect(() => {
    console.error('[pressbox] shared dashboard failed:', error);
  }, [error]);

  return (
    <div className="flex min-h-dvh items-center justify-center bg-zinc-50 px-6 dark:bg-zinc-950">
      <div className="max-w-sm text-center">
        <h1 className="text-base font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
          This dashboard could not be loaded
        </h1>
        <p className="mt-2 text-sm leading-relaxed text-zinc-600 dark:text-zinc-400">
          The link may have been revoked, or the landscape behind it may have been removed. Ask
          whoever shared it to publish a new link.
        </p>
      </div>
    </div>
  );
}
