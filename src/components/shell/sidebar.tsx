'use client';

import * as React from 'react';
import Link from 'next/link';
import { usePathname, useSearchParams } from 'next/navigation';
import { PanelLeft, PanelLeftClose } from 'lucide-react';
import { cn } from '@/lib/utils';
import { DumpsterMark } from './logo';
import { hrefWithGlobalParams } from '@/components/common/use-url-state';
import { usePersistentFlag } from '@/components/common/use-persistent-flag';
import { NAV_SECTIONS } from './nav';
import { LandscapeSwitcher, type LandscapeOption } from './landscape-switcher';

const STORAGE_KEY = 'pressbox.sidebar.collapsed';

export interface SidebarProps {
  landscapes: LandscapeOption[];
  activeLandscapeId: string | null;
}

export function Sidebar({ landscapes, activeLandscapeId }: SidebarProps) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [collapsed, setCollapsed] = usePersistentFlag(STORAGE_KEY);
  const toggle = () => setCollapsed(!collapsed);

  return (
    <aside
      data-collapsed={collapsed}
      className={cn(
        'sticky top-0 flex h-dvh shrink-0 flex-col border-r border-zinc-200 bg-white transition-[width] duration-150',
        'dark:border-zinc-800 dark:bg-zinc-950',
        collapsed ? 'w-14' : 'w-60',
      )}
    >
      <div className={cn('flex h-14 shrink-0 items-center gap-2 border-b border-zinc-200 px-3 dark:border-zinc-800')}>
        <Link
          href={hrefWithGlobalParams('/cross-channel', searchParams)}
          prefetch={false}
          className="flex min-w-0 items-center gap-2"
        >
          <span
            aria-hidden
            className="grid h-6 w-6 shrink-0 place-items-center rounded bg-accent-600 text-white"
          >
            <DumpsterMark className="h-4 w-4" />
          </span>
          {collapsed ? null : (
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

      {collapsed ? null : (
        <div className="border-b border-zinc-200 p-2 dark:border-zinc-800">
          <LandscapeSwitcher landscapes={landscapes} activeId={activeLandscapeId} />
        </div>
      )}

      <nav className="min-h-0 flex-1 overflow-y-auto px-2 py-3" aria-label="Primary">
        {NAV_SECTIONS.map((section) => (
          <div key={section.id} className="mb-4 last:mb-0">
            {section.label && !collapsed ? (
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
                      title={collapsed ? item.label : undefined}
                      aria-current={active ? 'page' : undefined}
                      className={cn(
                        'group flex h-7 items-center gap-2.5 rounded-md px-2 text-[13px] transition-colors',
                        collapsed && 'justify-center px-0',
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
                      ) : (
                        <span
                          aria-hidden
                          className="h-2 w-2 shrink-0 rounded-full ring-1 ring-inset ring-black/10 dark:ring-white/15"
                          style={{ backgroundColor: item.dotColor }}
                        />
                      )}
                      {collapsed ? <span className="sr-only">{item.label}</span> : <span className="truncate">{item.label}</span>}
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
          onClick={toggle}
          aria-expanded={!collapsed}
          className={cn(
            'flex h-7 w-full items-center gap-2.5 rounded-md px-2 text-[13px] text-zinc-500 transition-colors',
            'hover:bg-zinc-50 hover:text-zinc-900 dark:hover:bg-zinc-900 dark:hover:text-zinc-100',
            collapsed && 'justify-center px-0',
          )}
        >
          {collapsed ? (
            <PanelLeft className="h-3.5 w-3.5" strokeWidth={1.75} aria-hidden />
          ) : (
            <PanelLeftClose className="h-3.5 w-3.5" strokeWidth={1.75} aria-hidden />
          )}
          <span className={collapsed ? 'sr-only' : undefined}>Collapse sidebar</span>
        </button>
      </div>
    </aside>
  );
}
