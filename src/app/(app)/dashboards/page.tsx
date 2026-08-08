import type { Metadata } from 'next';
import Link from 'next/link';
import { LayoutDashboard, Link2 } from 'lucide-react';
import { Card, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { EmptyState } from '@/components/ui/empty-state';
import { formatRelative } from '@/components/ui/format';
import { CreateDashboard } from '@/components/dashboards/create-dashboard';
import { roleAtLeast } from '@/lib/roles';
import { resolveContext } from '../_lib/context';
import { query, type SearchParamsInput } from '../_lib/data';

export const metadata: Metadata = { title: 'Dashboards' };

type DashboardRow = {
  id: string;
  name: string;
  updated_at: string;
  widget_count: number | string;
  is_shared: boolean;
  landscape_name: string | null;
};

export default async function DashboardsPage({
  searchParams,
}: {
  searchParams: Promise<SearchParamsInput>;
}) {
  const ctx = await resolveContext(await searchParams);
  const orgId = ctx.orgId;

  const dashboards = await query<DashboardRow>(({ sql }) => sql`
    SELECT d.id, d.name, d.updated_at,
           jsonb_array_length(d.widgets) AS widget_count,
           (d.share_token IS NOT NULL) AS is_shared,
           l.name AS landscape_name
      FROM dashboards d
      LEFT JOIN landscapes l ON l.id = d.landscape_id
     WHERE d.org_id = ${orgId}::uuid
       AND (
         ${roleAtLeast(ctx.role, 'admin')}
         OR d.landscape_id IS NULL
         OR EXISTS (
           SELECT 1
             FROM user_landscape_access ula
            WHERE ula.landscape_id = d.landscape_id
              AND ula.user_id = ${ctx.userId}::uuid
         )
       )
     ORDER BY d.updated_at DESC
  `);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="max-w-2xl">
          <h2 className="text-base font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
            Custom dashboards
          </h2>
          <p className="mt-1 text-sm leading-relaxed text-zinc-600 dark:text-zinc-400">
            Build one when the same question gets asked every week. Widgets inherit the landscape and
            date window from the top bar, so a dashboard stays useful as the window moves.
          </p>
        </div>
        {roleAtLeast(ctx.role, 'editor') ? (
          <CreateDashboard
            landscapes={ctx.landscapes.map((l) => ({ id: l.id, name: l.name }))}
            defaultLandscapeId={ctx.landscape?.id ?? null}
          />
        ) : null}
      </div>

      {dashboards.error ? (
        <p className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700 dark:border-red-900/50 dark:bg-red-950/30 dark:text-red-400">
          {'Dashboards could not be listed: ' + dashboards.error}
        </p>
      ) : null}

      {dashboards.data.length === 0 ? (
        <Card>
          <EmptyState
            icon={LayoutDashboard}
            title="No dashboards yet"
            description="A new dashboard starts with three stat tiles, a leaderboard on engagement rate, and the platform mix. Change it from there."
          />
        </Card>
      ) : (
        <Card>
          <CardHeader>
            <CardTitle>
              {dashboards.data.length + (dashboards.data.length === 1 ? ' dashboard' : ' dashboards')}
            </CardTitle>
          </CardHeader>
          <ul className="divide-y divide-zinc-100 dark:divide-zinc-800/60">
            {dashboards.data.map((d) => (
              <li key={d.id}>
                <Link
                  href={'/dashboards/' + d.id}
                  className="flex items-center gap-3 px-4 py-3 transition-colors hover:bg-zinc-50 dark:hover:bg-zinc-800/40"
                >
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-zinc-900 dark:text-zinc-100">{d.name}</p>
                    <p className="pb-num mt-0.5 text-[11px] text-zinc-500">
                      {(d.landscape_name ?? 'No landscape') +
                        ' · ' +
                        (Number(d.widget_count) || 0) +
                        ' widgets · updated ' +
                        formatRelative(d.updated_at)}
                    </p>
                  </div>
                  {d.is_shared ? (
                    <Badge tone="accent">
                      <Link2 className="h-2.5 w-2.5" aria-hidden />
                      Shared
                    </Badge>
                  ) : null}
                </Link>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  );
}
