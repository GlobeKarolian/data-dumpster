'use client';

import * as React from 'react';
import { usePathname } from 'next/navigation';
import { Menu } from 'lucide-react';
import { PLATFORM_COLORS, PLATFORM_LABELS, type Platform } from '@/lib/types';
import { ADAPTER_SUPPORTED_PLATFORMS } from '@/lib/adapters/supported-platforms';
import { roleAtLeast, type Role } from '@/lib/roles';
import { publicationNoun } from '@/lib/platform-language';
import { DateRangePicker } from '@/components/ui/date-range-picker';
import { CompanyFilter, PlatformFilter, type CompanyOption } from './company-filter';
import { ExportMenu, type ExportTarget } from './export-menu';
import { RefreshButton } from './refresh-button';
import { NAV_PLATFORMS, ROUTE_TITLES } from './nav';

const PLATFORM_SET = new Set<string>(NAV_PLATFORMS);
const POST_EXPORT_ROUTES = new Set([
  '/cross-channel',
  '/leaderboard',
  '/stories',
  '/posts',
  '/content',
  '/post-tags',
  '/posted-urls',
]);
const PLATFORM_FILTER_ROUTES = new Set([
  '/cross-channel',
  '/leaderboard',
  '/content',
  '/posts',
  '/post-tags',
  '/posted-urls',
  '/ask',
]);
const PLATFORM_FILTER_OPTIONS = ADAPTER_SUPPORTED_PLATFORMS.map((platform) => ({
  value: platform,
  label: PLATFORM_LABELS[platform],
  color: PLATFORM_COLORS[platform],
  platform,
}));

function titleFor(pathname: string): string {
  const known = ROUTE_TITLES[pathname];
  if (known) return known;
  const first = pathname.split('/').filter(Boolean)[0];
  if (first && PLATFORM_SET.has(first)) return PLATFORM_LABELS[first as Platform];
  if (pathname.startsWith('/briefs/')) return 'Brief';
  if (pathname.startsWith('/dashboards/')) return 'Dashboard';
  return 'Data Dumpster';
}

const DEFAULT_EXPORTS: ExportTarget[] = [
  {
    label: 'Posts as CSV',
    href: '/api/posts/export',
    description: 'One row per post with engagement, tags and outlier score, streamed with the filters on screen.',
  },
];

export function Topbar({
  companies,
  focusCompanyId,
  exports,
  landscapeName,
  landscapeId,
  role,
  onOpenNavigation,
}: {
  companies: CompanyOption[];
  focusCompanyId: string | null;
  exports?: ExportTarget[];
  landscapeName: string | null;
  landscapeId: string | null;
  role: Role;
  onOpenNavigation: () => void;
}) {
  const pathname = usePathname();
  const first = pathname.split('/').filter(Boolean)[0];
  const isPlatform = Boolean(first && PLATFORM_SET.has(first));
  const showCompanyFilter = POST_EXPORT_ROUTES.has(pathname)
    || isPlatform
    || pathname.startsWith('/dashboards')
    || pathname === '/ask';
  const showDateFilter = showCompanyFilter || pathname === '/briefs';
  const fixedPlatform = isPlatform ? first as Platform : null;
  const defaultExports: ExportTarget[] = fixedPlatform ? [
    {
      ...DEFAULT_EXPORTS[0],
      label: publicationNoun(fixedPlatform) + ' as CSV',
      description:
        'One row per ' + publicationNoun(fixedPlatform, false).toLowerCase()
        + ' with engagement, tags and outlier score, streamed with the filters on screen.',
    },
  ] : DEFAULT_EXPORTS;
  const effectiveExports = exports ?? (
    POST_EXPORT_ROUTES.has(pathname) || isPlatform ? defaultExports : []
  );

  return (
    <header className="sticky top-0 z-30 flex min-h-14 max-w-full shrink-0 flex-wrap items-center gap-2 border-b border-zinc-200 bg-white/85 px-3 py-2 backdrop-blur-sm sm:flex-nowrap sm:gap-3 sm:px-4 dark:border-zinc-800 dark:bg-zinc-950/85">
      <button
        type="button"
        onClick={onOpenNavigation}
        aria-label="Open navigation"
        className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-md border border-zinc-200 text-zinc-600 md:hidden dark:border-zinc-700 dark:text-zinc-300"
      >
        <Menu className="h-4 w-4" aria-hidden />
      </button>
      <div className="min-w-0 flex-1">
        <h1 className="truncate text-sm font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
          {titleFor(pathname)}
        </h1>
        {landscapeName ? (
          <p className="truncate text-[11px] text-zinc-500 dark:text-zinc-500">{landscapeName}</p>
        ) : null}
      </div>

      <div className="relative w-full min-w-0 sm:w-auto sm:max-w-[75%] sm:flex-1">
        <div
          role="toolbar"
          aria-label="Page controls"
          className="flex w-full min-w-0 items-center gap-2 overflow-x-auto pb-0.5 pr-7 [scrollbar-width:thin] sm:flex-wrap sm:justify-end sm:overflow-visible sm:pb-0 sm:pr-0"
        >
          {PLATFORM_FILTER_ROUTES.has(pathname) ? (
          <PlatformFilter options={PLATFORM_FILTER_OPTIONS} />
          ) : null}
          {showCompanyFilter ? (
          <CompanyFilter companies={companies} focusCompanyId={focusCompanyId} />
          ) : null}
          {showDateFilter ? <DateRangePicker /> : null}
          {effectiveExports.length > 0 ? (
          <ExportMenu targets={effectiveExports} landscapeId={landscapeId} />
          ) : null}
          {roleAtLeast(role, 'editor') && landscapeId ? (
          <RefreshButton
            landscapeId={landscapeId}
            platforms={fixedPlatform ? [fixedPlatform] : undefined}
          />
          ) : null}
        </div>
        <span
          aria-hidden
          className="pointer-events-none absolute inset-y-0 right-0 w-8 bg-gradient-to-l from-white via-white/90 to-transparent sm:hidden dark:from-zinc-950 dark:via-zinc-950/90"
        />
      </div>
    </header>
  );
}
