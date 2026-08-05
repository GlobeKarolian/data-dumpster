'use client';

import * as React from 'react';
import Link from 'next/link';
import { usePathname, useSearchParams } from 'next/navigation';
import { PanelLeft, PanelLeftClose, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { DumpsterMark } from './logo';
import { hrefWithGlobalParams } from '@/components/common/use-url-state';
import { usePersistentFlag } from '@/components/common/use-persistent-flag';
import { NAV_SECTIONS } from './nav';
import { LandscapeSwitcher, type LandscapeOption } from './landscape-switcher';
import { PlatformIcon } from '@/components/ui/platform-icon';

const STORAGE_KEY = 'pressbox.sidebar.collapsed';

export interface SidebarProps {
  landscapes: LandscapeOption[];
  activeLandscapeId: string | null;
  mobileOpen: boolean;
  onMobileClose: () => void;
}

export function Sidebar({
  landscapes,
  activeLandscapeId,
  mobileOpen,
  onMobileClose,
}: SidebarProps) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [collapsed, setCollapsed] = usePersistentFlag(STORAGE_KEY);
  const toggle = () => setCollapsed(!collapsed);
  const compact = collapsed && !mobileOpen;

  return (
    <>
      {mobileOpen ? (
        <button
          type="button"
          aria-label="Dismiss navigation overlay"
          onClick={onMobileClose}
          className="fixed inset-0 z-40 bg-black/35 md:hidden"
        />
      ) : null}
    <aside
      data-collapsed={compact}
      className={cn(
        'fixed inset-y-0 left-0 z-50 flex h-dvh w-60 shrink-0 flex-col border-r border-zinc-200 bg-white transition-[transform,width] duration-150',
        'md:sticky md:top-0 md:z-auto md:translate-x-0',
        'dark:border-zinc-800 dark:bg-zinc-950',
        mobileOpen ? 'translate-x-0' : '-translate-x-full',
        compact ? 'md:w-14' : 'md:w-60',
      )}
    >
      <div className={cn('flex h-14 shrink-0 items-center gap-2 border-b border-zinc-200 px-3 dark:border-zinc-800')}>
        <Link
          href={hrefWithGlobalParams('/cross-channel', searchParams)}
          prefetch={false}
          onClick={mobileOpen ? onMobileClose : undefined}
          className="flex min-w-0 items-center gap-2"
        >
          <span
            aria-hidden
            className="grid h-6 w-6 shrink-0 place-items-center rounded bg-accent-600 text-white"
          >
            <DumpsterMark className="h-4 w-4" />
          </span>
          {compact ? null : (
            <span className="min-w-0 leading-tight">
              <span className="block text-[8px] font-semibold uppercase tracking-[0.16em] text-zinc-400 dark:text-zinc-500">
                Social Media
              </span>
              <span className="block truncate text-sm font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
                Data Dumpster
              </span>
            </span>
          )}
        </Link>
      </div>

      {compact ? null : (
        <div className="border-b border-zinc-200 p-2 dark:border-zinc-800">
          <LandscapeSwitcher landscapes={landscapes} activeId={activeLandscapeId} />
        </div>
      )}

      <nav className="min-h-0 flex-1 overflow-y-auto px-2 py-3" aria-label="Primary">
        {NAV_SECTIONS.map((section) => (
          <div key={section.id} className="mb-4 last:mb-0">
            {section.label && !compact ? (
              <h2 className="px-2 pb-1.5 text-[10px] font-semibold uppercase tracking-[0.12em] text-zinc-400 dark:text-zinc-600">
                {section.label}
              </h2>
            ) : null}
            <ul className="space-y-0.5">
              {section.items.map((item) => {
                const active = item.matchPrefix
                  ? pathname === item.href || pathname.startsWith(item.href + '/')
                  : pathname === item.href;
                const Icon = item.icon;
                return (
                  <li key={item.href}>
                    <Link
                      href={hrefWithGlobalParams(item.href, searchParams)}
                      prefetch={false}
                      onClick={mobileOpen ? onMobileClose : undefined}
                      title={collapsed ? item.label : undefined}
                      aria-current={active ? 'page' : undefined}
                      className={cn(
                        'group flex h-7 items-center gap-2.5 rounded-md px-2 text-[13px] transition-colors',
                        compact && 'justify-center px-0',
                        active
                          ? 'bg-zinc-100 font-medium text-zinc-900 dark:bg-zinc-800/80 dark:text-zinc-50'
                          : 'text-zinc-600 hover:bg-zinc-50 hover:text-zinc-900 dark:text-zinc-400 dark:hover:bg-zinc-900 dark:hover:text-zinc-100',
                      )}
                    >
                      {Icon ? (
                        <Icon
                          className={cn(
                            'h-3.5 w-3.5 shrink-0',
                            active ? 'text-accent-600' : 'text-zinc-400 dark:text-zinc-600',
                          )}
                          strokeWidth={1.75}
                          aria-hidden
                        />
                      ) : item.platform ? (
                        <PlatformIcon platform={item.platform} />
                      ) : null}
                      {compact ? <span className="sr-only">{item.label}</span> : <span className="truncate">{item.label}</span>}
                    </Link>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </nav>

      <div className="shrink-0 border-t border-zinc-200 p-2 dark:border-zinc-800">
        <button
          type="button"
          onClick={mobileOpen ? onMobileClose : toggle}
          aria-expanded={mobileOpen ? true : !collapsed}
          className={cn(
            'flex h-7 w-full items-center gap-2.5 rounded-md px-2 text-[13px] text-zinc-500 transition-colors',
            'hover:bg-zinc-50 hover:text-zinc-900 dark:hover:bg-zinc-900 dark:hover:text-zinc-100',
            compact && 'justify-center px-0',
          )}
        >
          {mobileOpen ? (
            <X className="h-3.5 w-3.5" strokeWidth={1.75} aria-hidden />
          ) : collapsed ? (
            <PanelLeft className="h-3.5 w-3.5" strokeWidth={1.75} aria-hidden />
          ) : (
            <PanelLeftClose className="h-3.5 w-3.5" strokeWidth={1.75} aria-hidden />
          )}
          <span className={compact ? 'sr-only' : undefined}>
            {mobileOpen ? 'Close navigation' : 'Collapse sidebar'}
          </span>
        </button>
      </div>
    </aside>
    </>
  );
}
