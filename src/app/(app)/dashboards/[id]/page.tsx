import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { ArrowRight } from 'lucide-react';
import { NoLandscape } from '@/components/common/no-landscape';
import { DashboardEditor } from '@/components/dashboards/dashboard-editor';
import { WidgetGrid } from '@/components/dashboards/widget-grid';
import { parseWidgets } from '@/components/dashboards/widget-types';
import { formatFullDate } from '@/components/ui/format';
import { roleAtLeast } from '@/lib/roles';
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

type MemberRow = {
  id: string;
  name: string;
  slug: string;
  logo_url: string | null;
  color: string | null;
  segment: string | null;
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

  if (result.error) throw new Error('Dashboard could not load: ' + result.error);
  const dashboard = result.data[0];
  if (!dashboard) notFound();

  // A saved dashboard owns its landscape. Align the URL-driven shell before
  // rendering so the top bar cannot name one landscape while the widgets query
  // another. Company ids belong to the old landscape and must not cross over.
  if (dashboard.landscape_id && dashboard.landscape_id !== ctx.landscape?.id) {
    const next = new URLSearchParams(ctx.searchParams);
    next.set('landscape', dashboard.landscape_id);
    next.delete('companies');
    redirect('/dashboards/' + id + '?' + next.toString());
  }

  const widgets = parseWidgets(dashboard.widgets);
  const landscape =
    ctx.landscapes.find((l) => l.id === dashboard.landscape_id) ?? ctx.landscape ?? null;

  if (!landscape) return <NoLandscape reason={ctx.error} />;

  /**
   * A dashboard pins its own landscape, which need not be the one selected in
   * the top bar. When they differ, everything the top bar contributed about
   * companies belongs to a different set of ids: `ctx.companies` would label the
   * chart series with the wrong newsroom, and `ctx.companyIds` (the company
   * filter) would intersect to nothing inside resolveScope, so every widget
   * would render a confident zero rather than an error. Both are dropped in that
   * case and the dashboard's own membership is read instead.
   */
  const sameAsToolbar = landscape.id === ctx.landscape?.id;
  let companies = ctx.companies;
  if (!sameAsToolbar) {
    const members = await query<MemberRow>(({ sql }) => sql`
      -- The dashboard and landscape are already org-scoped. Membership, not
      -- the pooled company's attribution org, authorizes this read.
      SELECT c.id, c.name, c.slug, c.logo_url, c.color, c.segment
       FROM landscape_companies lc
        JOIN companies c ON c.id = lc.company_id
       WHERE lc.landscape_id = ${landscape.id}::uuid
       ORDER BY lc.sort_order ASC, c.name ASC
    `);
    if (members.error) throw new Error('Dashboard companies could not load: ' + members.error);
    companies = members.data.map((c) => ({
      id: c.id,
      name: c.name,
      slug: c.slug,
      logoUrl: c.logo_url,
      color: c.color,
      segment: c.segment,
    }));
  }

  const api = await metricsApi();
  const canEdit = roleAtLeast(ctx.role, 'editor');
  const baseQuery = analyticsQuery(
    { ...ctx, landscape, focusCompanyId: landscape.focusCompanyId },
    sameAsToolbar ? undefined : { companyIds: undefined },
  );

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

      {canEdit ? (
        <DashboardEditor
          dashboardId={dashboard.id}
          widgets={widgets}
          isShared={dashboard.share_token !== null}
          shareUrl={dashboard.share_token ? '/share/' + dashboard.share_token : null}
        />
      ) : null}

      <WidgetGrid
        widgets={widgets}
        query={baseQuery}
        companies={companies}
        focusCompanyId={landscape.focusCompanyId}
        api={api}
        readOnly={!canEdit}
      />
    </div>
  );
}
