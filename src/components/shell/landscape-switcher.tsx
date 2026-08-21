'use client';

import * as React from 'react';
import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { Check, ChevronsUpDown, Plus } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Popover } from '@/components/ui/popover';
import { hrefWithGlobalParams, useUrlState } from '@/components/common/use-url-state';

export interface LandscapeOption {
  id: string;
  name: string;
  focusCompanyName: string | null;
  companyCount: number;
}

/**
 * The landscape is the unit of comparison for the whole product, so it sits
 * above the navigation rather than inside a filter bar. Switching it rewrites
 * the URL, which means every screen and every shared link stays consistent.
 */
export function LandscapeSwitcher({
  landscapes,
  activeId,
}: {
  landscapes: LandscapeOption[];
  activeId: string | null;
}) {
  const { setParams } = useUrlState();
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const active = landscapes.find((l) => l.id === activeId) ?? landscapes[0] ?? null;

  /**
   * A saved dashboard pins its own landscape, and the detail page reasserts
   * that pin on every load. Rewriting the landscape param in place on such a
   * page therefore does nothing: the redirect snaps straight back, and the
   * switcher reads as broken. An explicit switch while viewing a pinned
   * dashboard means "take me to that landscape", so it leaves the dashboard
   * and lands on the dashboards list instead.
   */
  const pinnedByDashboard = /^\/dashboards\/[0-9a-f-]{36}/i.test(pathname);
  const selectLandscape = (id: string) => {
    if (pinnedByDashboard) {
      router.push(hrefWithGlobalParams('/dashboards', searchParams, { landscape: id, companies: null }));
    } else {
      setParams({ landscape: id, companies: null });
    }
  };

  if (landscapes.length === 0) {
    return (
      <Link
        href="/settings/companies"
        className="flex h-11 w-full items-center gap-2 rounded-md border border-dashed border-zinc-300 px-2.5 text-left transition-colors hover:border-accent-600 dark:border-zinc-700"
      >
        <Plus className="h-3.5 w-3.5 shrink-0 text-zinc-400" aria-hidden />
        <span className="min-w-0">
          <span className="block truncate text-xs font-medium text-zinc-700 dark:text-zinc-300">
            Create a landscape
          </span>
          <span className="block truncate text-[10px] text-zinc-500">One focus brand, then rivals</span>
        </span>
      </Link>
    );
  }

  return (
    <Popover
      label="Switch landscape"
      panelClassName="w-[15rem]"
      trigger={({ open }) => (
        <span
          className={cn(
            'flex h-11 w-full items-center gap-2 rounded-md border px-2.5 text-left transition-colors',
            'border-zinc-200 bg-zinc-50 hover:bg-zinc-100',
            'dark:border-zinc-800 dark:bg-zinc-900 dark:hover:bg-zinc-800',
            open && 'border-accent-600 dark:border-accent-500',
          )}
        >
          <span className="min-w-0 flex-1">
            <span className="block truncate text-xs font-semibold text-zinc-900 dark:text-zinc-100">
              {active?.name ?? 'Select a landscape'}
            </span>
            <span className="block truncate text-[10px] text-zinc-500 dark:text-zinc-500">
              {active
                ? (active.focusCompanyName ?? 'No focus company') + ' · ' + active.companyCount + ' companies'
                : ''}
            </span>
          </span>
          <ChevronsUpDown className="h-3.5 w-3.5 shrink-0 text-zinc-400" aria-hidden />
        </span>
      )}
    >
      {({ close }) => (
        <div>
          <p className="border-b border-zinc-200 px-3 py-2 text-[10px] font-semibold uppercase tracking-wider text-zinc-400 dark:border-zinc-700 dark:text-zinc-500">
            Landscapes
          </p>
          <div className="max-h-72 overflow-y-auto p-1">
            {landscapes.map((l) => {
              const on = l.id === active?.id;
              return (
                <button
                  key={l.id}
                  type="button"
                  onClick={() => {
                    selectLandscape(l.id);
                    close();
                  }}
                  className={cn(
                    'flex w-full items-start gap-2 rounded px-2 py-1.5 text-left transition-colors',
                    'hover:bg-zinc-100 dark:hover:bg-zinc-800',
                  )}
                >
                  <span className="min-w-0 flex-1">
                    <span
                      className={cn(
                        'block truncate text-xs',
                        on
                          ? 'font-medium text-zinc-900 dark:text-zinc-100'
                          : 'text-zinc-700 dark:text-zinc-300',
                      )}
                    >
                      {l.name}
                    </span>
                    <span className="block truncate text-[10px] text-zinc-500">
                      {(l.focusCompanyName ?? 'No focus company') + ' · ' + l.companyCount + ' companies'}
                    </span>
                  </span>
                  {on ? <Check className="mt-0.5 h-3 w-3 shrink-0 text-accent-600" aria-hidden /> : null}
                </button>
              );
            })}
          </div>
          <div className="border-t border-zinc-200 p-1 dark:border-zinc-700">
            <Link
              href="/settings/companies"
              onClick={close}
              className="flex items-center gap-1.5 rounded px-2 py-1.5 text-xs text-zinc-600 transition-colors hover:bg-zinc-100 hover:text-zinc-900 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-zinc-100"
            >
              <Plus className="h-3 w-3" aria-hidden />
              Manage landscapes
            </Link>
          </div>
        </div>
      )}
    </Popover>
  );
}
