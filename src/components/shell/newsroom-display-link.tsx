'use client';

import * as React from 'react';
import { useSearchParams } from 'next/navigation';
import { MonitorUp } from 'lucide-react';
import type { Platform } from '@/lib/types';

const DISPLAY_PARAMS = ['companies', 'platforms', 'types', 'tags'] as const;

export function NewsroomDisplayLink({
  landscapeId,
  platform,
}: {
  landscapeId: string;
  platform?: Platform | null;
}) {
  const searchParams = useSearchParams();
  const href = React.useMemo(() => {
    const next = new URLSearchParams();
    next.set('landscape', landscapeId);
    for (const key of DISPLAY_PARAMS) {
      const value = searchParams.get(key);
      if (value) next.set(key, value);
    }
    if (platform) next.set('platforms', platform);
    return `/newsroom?${next.toString()}`;
  }, [landscapeId, platform, searchParams]);

  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="inline-flex h-9 shrink-0 items-center gap-1.5 rounded-md border border-zinc-200 bg-white px-3 text-xs font-semibold text-zinc-700 transition-colors hover:border-zinc-300 hover:bg-zinc-50 hover:text-zinc-950 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-300 dark:hover:bg-zinc-800 dark:hover:text-white"
      title="Open a full-screen, auto-rotating newsroom display"
    >
      <MonitorUp className="h-3.5 w-3.5" aria-hidden />
      <span className="hidden xl:inline">Newsroom screen</span>
      <span className="xl:hidden">Screen</span>
    </a>
  );
}
