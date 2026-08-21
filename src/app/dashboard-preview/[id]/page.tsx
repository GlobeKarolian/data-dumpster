import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { WidgetGrid } from '@/components/dashboards/widget-grid';
import { parseWidgets } from '@/components/dashboards/widget-types';
import { analyticsQuery, resolveContext } from '../../(app)/_lib/context';
import { metricsApi, query, type SearchParamsInput } from '../../(app)/_lib/data';

export const metadata: Metadata = { title: 'Widget preview', robots: { index: false } };
export const dynamic = 'force-dynamic';

type DashboardRow = { id: string; landscape_id: string | null };
type MemberRow = {
  id: string; name: string; slug: string;
  logo_url: string | null; color: string | null; segment: string | null;
};

/**
 * One widget, rendered exactly as the dashboard will render it.
 *
 * This page exists so the editor can show a live preview while a widget is
 * being configured. It deliberately renders through the same WidgetGrid as the
 * dashboard and the public share link — a preview drawn by any other code path
 * would eventually lie about what saving will produce.
 *
 * The draft arrives base64url-encoded in ?w= and passes through the same
 * defensive parseWidgets as stored layouts, so a malformed draft renders
 * nothing rather than something surprising. Auth is the dashboard detail
 * page's: org membership plus access to the dashboard's landscape.
 */
export default async function WidgetPreviewPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<SearchParamsInput>;
}) {
  const [{ id }, resolvedSearch] = await Promise.all([params, searchParams]);
  const ctx = await resolveContext(resolvedSearch);

  const result = await query<DashboardRow>(({ sql }) => sql`
    SELECT id, landscape_id
      FROM dashboards
     WHERE id = ${id}::uuid AND org_id = ${ctx.orgId}::uuid
     LIMIT 1
  `);
  if (result.error) throw new Error('Preview could not load: ' + result.error);
  const dashboard = result.data[0];
  if (!dashboard) notFound();
  if (
    dashboard.landscape_id
    && !ctx.landscapes.some((landscape) => landscape.id === dashboard.landscape_id)
  ) {
    notFound();
  }

  const landscape =
    ctx.landscapes.find((l) => l.id === dashboard.landscape_id) ?? ctx.landscape ?? null;
  if (!landscape) notFound();

  const raw = typeof resolvedSearch.w === 'string' ? resolvedSearch.w : '';
  let draft = null;
  try {
    const decoded = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8')) as unknown;
    draft = parseWidgets([decoded])[0] ?? null;
  } catch {
    draft = null;
  }

  if (!draft) {
    return (
      <div className="flex h-64 items-center justify-center p-6 text-xs text-zinc-500">
        Configure the widget to see its preview.
      </div>
    );
  }
  // The preview shows one widget at readable size regardless of its span; the
  // span applies on the dashboard grid, not here.
  draft = { ...draft, span: 12 as const };

  const sameAsToolbar = landscape.id === ctx.landscape?.id;
  let companies = ctx.companies;
  if (!sameAsToolbar) {
    const members = await query<MemberRow>(({ sql }) => sql`
      SELECT c.id, c.name, c.slug, c.logo_url, c.color, c.segment
        FROM landscape_companies lc
        JOIN companies c ON c.id = lc.company_id
       WHERE lc.landscape_id = ${landscape.id}::uuid
       ORDER BY lc.sort_order ASC, c.name ASC
    `);
    if (members.error) throw new Error('Preview companies could not load: ' + members.error);
    companies = members.data.map((c) => ({
      id: c.id, name: c.name, slug: c.slug,
      logoUrl: c.logo_url, color: c.color, segment: c.segment,
    }));
  }

  const api = await metricsApi();
  const baseQuery = analyticsQuery(
    { ...ctx, landscape, focusCompanyId: landscape.focusCompanyId },
    sameAsToolbar ? undefined : { companyIds: undefined },
  );

  return (
    <div className="p-3">
      <WidgetGrid
        widgets={[draft]}
        query={baseQuery}
        companies={companies}
        focusCompanyId={landscape.focusCompanyId}
        api={api}
        readOnly
      />
    </div>
  );
}
