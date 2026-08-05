'use client';

import * as React from 'react';
import { useSearchParams } from 'next/navigation';
import { Sidebar } from './sidebar';
import { Topbar } from './topbar';
import type { LandscapeOption } from './landscape-switcher';
import type { CompanyOption } from './company-filter';
import type { Role } from '@/lib/roles';

export interface ShellLandscape extends LandscapeOption {
  focusCompanyId: string | null;
  slug: string;
  companies: CompanyOption[];
}

/**
 * Chrome resolves the active landscape from the URL rather than from the
 * layout, because a layout in the App Router never sees search params. The
 * whole landscape roster is loaded once on the server and the switch itself is
 * instant, which is the right trade for a set that is measured in dozens.
 */
export function AppShell({
  landscapes,
  role,
  children,
}: {
  landscapes: ShellLandscape[];
  role: Role;
  children: React.ReactNode;
}) {
  const [mobileNavOpen, setMobileNavOpen] = React.useState(false);
  const searchParams = useSearchParams();
  const requested = searchParams.get('landscape');
  const active =
    landscapes.find((l) => l.id === requested) ??
    landscapes.find((l) => l.slug === requested) ??
    landscapes[0] ??
    null;

  return (
    <div className="flex min-h-dvh w-full max-w-full">
      <Sidebar
        landscapes={landscapes.map((l) => ({
          id: l.id,
          name: l.name,
          focusCompanyName: l.focusCompanyName,
          companyCount: l.companyCount,
        }))}
        activeLandscapeId={active?.id ?? null}
        mobileOpen={mobileNavOpen}
        onMobileClose={() => setMobileNavOpen(false)}
      />
      <div className="flex w-0 min-w-0 max-w-full flex-1 flex-col">
        <Topbar
          companies={active?.companies ?? []}
          focusCompanyId={active?.focusCompanyId ?? null}
          landscapeName={active?.name ?? null}
          landscapeId={active?.id ?? null}
          role={role}
          onOpenNavigation={() => setMobileNavOpen(true)}
        />
        <main className="w-full min-w-0 max-w-full flex-1 px-4 py-5 lg:px-6">
          {children}
        </main>
      </div>
    </div>
  );
}
