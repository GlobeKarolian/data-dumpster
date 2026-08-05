'use client';

import Link from 'next/link';
import { usePathname, useSearchParams } from 'next/navigation';
import { hrefWithGlobalParams } from '@/components/common/use-url-state';
import { cn } from '@/lib/utils';

const TABS = [
  { href: '/cross-channel', label: 'Overview' },
  { href: '/leaderboard', label: 'Leaderboard' },
  { href: '/posts', label: 'Social Posts' },
  { href: '/post-tags', label: 'Post Tags' },
  { href: '/posted-urls', label: 'Posted URLs' },
] as const;

export function CrossChannelTabs() {
  const pathname = usePathname();
  const searchParams = useSearchParams();

  return (
    <nav
      aria-label="Cross-channel sections"
      className="relative border-b border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-950"
    >
      <div className="flex min-w-0 flex-nowrap overflow-x-auto px-4 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {TABS.map((tab) => {
          const active = pathname === tab.href || pathname.startsWith(tab.href + '/');

          return (
            <Link
              key={tab.href}
              href={hrefWithGlobalParams(tab.href, searchParams)}
              prefetch={false}
              aria-current={active ? 'page' : undefined}
              className={cn(
                'relative -mb-px inline-flex h-10 shrink-0 items-center whitespace-nowrap border-b-2 px-3 text-xs font-medium transition-colors',
                'focus-visible:z-10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-500 focus-visible:ring-offset-2 dark:focus-visible:ring-offset-zinc-950',
                active
                  ? 'border-accent-600 text-zinc-950 dark:text-zinc-50'
                  : 'border-transparent text-zinc-500 hover:border-zinc-300 hover:text-zinc-900 dark:text-zinc-400 dark:hover:border-zinc-700 dark:hover:text-zinc-100',
              )}
            >
              {tab.label}
            </Link>
          );
        })}
      </div>
      <span
        aria-hidden
        className="pointer-events-none absolute inset-y-0 right-0 w-8 bg-gradient-to-l from-white via-white/90 to-transparent lg:hidden dark:from-zinc-950 dark:via-zinc-950/90"
      />
    </nav>
  );
}
