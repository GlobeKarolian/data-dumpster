import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ArrowRight } from 'lucide-react';
import { NoLandscape } from '@/components/common/no-landscape';
import { DashboardEditor } from '@/components/dashboards/dashboard-editor';
import { WidgetGrid } from '@/components/dashboards/widget-grid';
import { parseWidgets } from '@/components/dashboards/widget-types';
import { formatFullDate } from '@/components/ui/format';
import { analyticsQuery, resolveContext } from '../../_lib/context';
import { metricsApi, query, type SearchParamsInput } from '../../_lib/data';

export const metadata: Metadata = { title: 'Dashboard' };

type DashboardRow = {
  id: string;
  name: string;
  widgets: unknown;
  landscape_id: string | null;
  share_token: string | null;
};

export default async function DashboardDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<SearchParamsInput>;
}) {
  const [{ id }, resolvedSearch] = await Promise.all([params, searchParams]);
  const ctx = await resolveContext(resolvedSearch);

  const result = await query<DashboardRow>(({ sql }) => sql`
    SELECT id, name, widgets, landscape_id, share_token
      FROM dashboards
     WHERE id = ${id}::uuid
       AND org_id = ${ctx.orgId}::uuid
     LIMIT 1
  `);

  const dashboard = result.data[0];
  if (!dashboard) notFound();

  const widgets = parseWidgets(dashboard.widgets);
  const landscape =
    ctx.landscapes.find((l) => l.id === dashboard.landscape_id) ?? ctx.landscape ?? null;

  if (!landscape) return <NoLandscape reason={ctx.error} />;

  const api = await metricsApi();
  const baseQuery = analyticsQuery({ ...ctx, landscape, focusCompanyId: landscape.focusCompanyId });

  return (
    <div>
      <Link
        href="/dashboards"
        className="inline-flex items-center gap-1 text-xs text-zinc-500 transition-colors hover:text-zinc-900 dark:hover:text-zinc-100"
      >
        <ArrowRight className="h-3 w-3 rotate-180" aria-hidden />
        All dashboards
      </Link>

      <div className="mb-4 mt-3">
        <h2 className="text-base font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
          {dashboard.name}
        </h2>
        <p className="pb-num mt-0.5 text-[11px] text-zinc-500">
          {landscape.name +
            ' · ' +
            formatFullDate(ctx.range.start) +
            ' – ' +
            formatFullDate(ctx.range.end)}
        </p>
      </div>

      <DashboardEditor
        dashboardId={dashboard.id}
        widgets={widgets}
        isShared={dashboard.share_token !== null}
        shareUrl={dashboard.share_token ? '/share/' + dashboard.share_token : null}
      />

      <WidgetGrid
        widgets={widgets}
        query={baseQuery}
        companies={ctx.companies}
        focusCompanyId={landscape.focusCompanyId}
        api={api}
      />
    </div>
  );
}
