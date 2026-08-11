import * as React from 'react';
import { redirect } from 'next/navigation';
import { AppShell, type ShellLandscape } from '@/components/shell/app-shell';
import { canTriggerManualRefresh } from '@/lib/manual-refresh-policy';
import type { Role } from '@/lib/roles';
import { query } from './_lib/data';

export const dynamic = 'force-dynamic';

type LandscapeRow = {
  id: string;
  name: string;
  slug: string;
  focus_company_id: string | null;
  focus_company_name: string | null;
  company_count: number | string;
}

type MemberRow = {
  landscape_id: string;
  id: string;
  name: string;
  color: string | null;
}

type PendingAccessRow = { count: number | string };

/**
 * The shell loads the whole landscape roster once, because the switcher has to
 * work without a round trip and because a newsroom's competitive sets number in
 * the dozens, not the thousands.
 */
export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const { requireOrg } = await import('@/lib/session');

  let orgId: string;
  let userId: string;
  let role: Role;
  let manualRefreshAllowed: boolean;
  try {
    const session = await requireOrg();
    orgId = session.orgId;
    userId = session.userId;
    role = session.role;
    manualRefreshAllowed = canTriggerManualRefresh(session.email);
  } catch {
    redirect('/login');
  }

  const [landscapes, members, pendingAccess] = await Promise.all([
    query<LandscapeRow>(({ sql }) => sql`
      SELECT l.id, l.name, l.slug, l.focus_company_id,
             fc.name AS focus_company_name,
             count(lc.company_id) AS company_count
        FROM landscapes l
        LEFT JOIN companies fc ON fc.id = l.focus_company_id
        LEFT JOIN landscape_companies lc ON lc.landscape_id = l.id
       WHERE l.org_id = ${orgId}::uuid
         AND (
           ${role === 'admin' || role === 'owner'}
           OR EXISTS (
             SELECT 1
               FROM user_landscape_access ula
              WHERE ula.landscape_id = l.id
                AND ula.user_id = ${userId}::uuid
           )
         )
       GROUP BY l.id, l.name, l.slug, l.focus_company_id, fc.name
       ORDER BY l.name ASC
    `),
    query<MemberRow>(({ sql }) => sql`
      SELECT lc.landscape_id, c.id, c.name, c.color
        FROM landscape_companies lc
        JOIN companies c ON c.id = lc.company_id
        JOIN landscapes l ON l.id = lc.landscape_id
       WHERE l.org_id = ${orgId}::uuid
         AND (
           ${role === 'admin' || role === 'owner'}
           OR EXISTS (
             SELECT 1
               FROM user_landscape_access ula
              WHERE ula.landscape_id = l.id
                AND ula.user_id = ${userId}::uuid
           )
         )
       ORDER BY lc.sort_order ASC, c.name ASC
    `),
    role === 'admin' || role === 'owner'
      ? query<PendingAccessRow>(({ sql }) => sql`
          SELECT count(*) AS count
            FROM access_requests
           WHERE org_id = ${orgId}::uuid
             AND status = 'pending'
        `)
      : Promise.resolve({ data: [], error: null }),
  ]);

  const byLandscape = new Map<string, { id: string; name: string; color: string | null }[]>();
  for (const m of members.data) {
    const bucket = byLandscape.get(m.landscape_id) ?? [];
    bucket.push({ id: m.id, name: m.name, color: m.color });
    byLandscape.set(m.landscape_id, bucket);
  }

  const shellLandscapes: ShellLandscape[] = landscapes.data.map((l) => ({
    id: l.id,
    name: l.name,
    slug: l.slug,
    focusCompanyId: l.focus_company_id,
    focusCompanyName: l.focus_company_name,
    companyCount: Number(l.company_count) || 0,
    companies: byLandscape.get(l.id) ?? [],
  }));

  return (
    <AppShell
      landscapes={shellLandscapes}
      role={role}
      manualRefreshAllowed={manualRefreshAllowed}
      pendingAccessRequests={Number(pendingAccess.data[0]?.count ?? 0)}
    >
      {children}
    </AppShell>
  );
}
