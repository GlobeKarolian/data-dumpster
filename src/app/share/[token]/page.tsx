import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import type { AnalyticsQuery, CompanyRef } from '@/lib/types';
import { autoGranularity, parseRangeParams } from '@/lib/dates';
import { WidgetGrid } from '@/components/dashboards/widget-grid';
import { parseWidgets } from '@/components/dashboards/widget-types';
import { formatFullDate } from '@/components/ui/format';
import { metricsApi, query, type SearchParamsInput } from '../../(app)/_lib/data';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Shared dashboard',
  robots: { index: false, follow: false },
};

type ShareRow = {
  id: string;
  name: string;
  widgets: unknown;
  org_id: string;
  landscape_id: string | null;
  landscape_name: string | null;
  focus_company_id: string | null;
  updated_at: string;
};

type MemberRow = {
  id: string;
  name: string;
  slug: string;
  logo_url: string | null;
  color: string | null;
  segment: string | null;
};

/**
 * A published dashboard.
 *
 * No chrome, no navigation, no sign-in. The token is the authorization, so this
 * route reads the dashboard by token and derives the tenant from the row rather
 * than from a session — a shared link must never be able to widen its own scope.
 * Everything below renders through the same WidgetGrid the signed-in dashboard
 * uses, so a shared number and an internal number cannot disagree.
 */
export default async function SharedDashboardPage({
  params,
  searchParams,
}: {
  params: Promise<{ token: string }>;
  searchParams: Promise<SearchParamsInput>;
}) {
  const [{ token }, resolvedSearch] = await Promise.all([params, searchParams]);

  const result = await query<ShareRow>(({ sql }) => sql`
    SELECT d.id, d.name, d.widgets, d.org_id, d.landscape_id, d.updated_at,
           l.name AS landscape_name,
           l.focus_company_id
      FROM dashboards d
      LEFT JOIN landscapes l ON l.id = d.landscape_id
     WHERE d.share_token = ${token}
     LIMIT 1
  `);

  const dashboard = result.data[0];
  if (!dashboard || !dashboard.landscape_id) notFound();

  const landscapeId = dashboard.landscape_id;
  const members = await query<MemberRow>(({ sql }) => sql`
    SELECT c.id, c.name, c.slug, c.logo_url, c.color, c.segment
      FROM landscape_companies lc
      JOIN companies c ON c.id = lc.company_id
     WHERE lc.landscape_id = ${landscapeId}::uuid
     ORDER BY lc.sort_order ASC, c.name ASC
  `);

  const companies: CompanyRef[] = members.data.map((c) => ({
    id: c.id,
    name: c.name,
    slug: c.slug,
    logoUrl: c.logo_url,
    color: c.color,
    segment: c.segment,
  }));

  const sp = new URLSearchParams();
  for (const [key, value] of Object.entries(resolvedSearch)) {
    if (typeof value === 'string') sp.set(key, value);
  }
  const range = parseRangeParams(sp);

  const baseQuery: AnalyticsQuery & { orgId?: string } = {
    landscapeId,
    orgId: dashboard.org_id,
    start: range.start,
    end: range.end,
    granularity: autoGranularity(range),
    compare: true,
  };

  const widgets = parseWidgets(dashboard.widgets);
  const api = await metricsApi();

  return (
    <div className="min-h-dvh bg-zinc-50 dark:bg-zinc-950">
      <header className="border-b border-zinc-200 bg-white px-6 py-4 dark:border-zinc-800 dark:bg-zinc-950">
        <div className="mx-auto flex max-w-7xl flex-wrap items-end justify-between gap-3">
          <div className="min-w-0">
            <h1 className="truncate text-base font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
              {dashboard.name}
            </h1>
            <p className="pb-num mt-0.5 text-[11px] text-zinc-500">
              {(dashboard.landscape_name ?? 'Landscape') +
                ' · ' +
                formatFullDate(range.start) +
                ' – ' +
                formatFullDate(range.end)}
            </p>
          </div>
          <div className="flex items-center gap-2 text-[11px] text-zinc-400">
            <span
              aria-hidden
              className="flex h-5 w-5 items-center justify-center rounded bg-accent-600 text-[10px] font-bold text-white"
            >
              P
            </span>
            <span>Published from Data Dumpster</span>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-7xl px-6 py-6">
        <WidgetGrid
          widgets={widgets}
          query={baseQuery}
          companies={companies}
          focusCompanyId={dashboard.focus_company_id}
          api={api}
          readOnly
        />
      </main>

      <footer className="mx-auto max-w-7xl px-6 pb-10">
        <p className="border-t border-zinc-200 pt-4 text-[11px] leading-relaxed text-zinc-400 dark:border-zinc-800 dark:text-zinc-600">
          This is a read-only view. Figures are computed live against the same query engine the
          newsroom uses internally; every metric name here has a formal definition, and any percent
          change against a near-zero baseline is reported as unmeasurable rather than as a large
          number.
        </p>
      </footer>
    </div>
  );
}
