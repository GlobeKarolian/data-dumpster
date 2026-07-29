'use client';

import * as React from 'react';
import { usePathname } from 'next/navigation';
import { PLATFORMS, PLATFORM_LABELS, type Platform } from '@/lib/types';
import { DateRangePicker } from '@/components/ui/date-range-picker';
import { CompanyFilter, type CompanyOption } from './company-filter';
import { ExportMenu, type ExportTarget } from './export-menu';
import { ROUTE_TITLES } from './nav';

const PLATFORM_SET = new Set<string>(PLATFORMS);

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
  exports = DEFAULT_EXPORTS,
  landscapeName,
  landscapeId,
}: {
  companies: CompanyOption[];
  focusCompanyId: string | null;
  exports?: ExportTarget[];
  landscapeName: string | null;
  landscapeId: string | null;
}) {
  const pathname = usePathname();

  return (
    <header className="sticky top-0 z-30 flex h-14 shrink-0 items-center gap-3 border-b border-zinc-200 bg-white/85 px-4 backdrop-blur-sm dark:border-zinc-800 dark:bg-zinc-950/85">
      <div className="min-w-0 flex-1">
        <h1 className="truncate text-sm font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
          {titleFor(pathname)}
        </h1>
        {landscapeName ? (
          <p className="truncate text-[11px] text-zinc-500 dark:text-zinc-500">{landscapeName}</p>
        ) : null}
      </div>

      <div className="flex shrink-0 items-center gap-2">
        <CompanyFilter companies={companies} focusCompanyId={focusCompanyId} />
        <DateRangePicker />
        <ExportMenu targets={exports} landscapeId={landscapeId} />
      </div>
    </header>
  );
}
