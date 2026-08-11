import type { Metadata } from 'next';
import Link from 'next/link';
import { effectiveFocusCompanyId } from '@/lib/analytics-scope';
import { PLATFORM_LABELS } from '@/lib/types';
import { formatFullDate } from '@/components/ui/format';
import { NewsroomDisplay } from '@/components/newsroom/newsroom-display';
import {
  NEWSROOM_PLATFORMS,
  newsroomTodaySearchParams,
  newsroomTrailing24Hours,
} from '@/lib/newsroom-display';
import {
  analyticsQuery,
  resolveContext,
} from '@/app/(app)/_lib/context';
import {
  loadLeaderboard,
  loadSummary,
  loadTopPostsByPlatform,
  query,
  type SearchParamsInput,
} from '@/app/(app)/_lib/data';

export const metadata: Metadata = { title: 'Newsroom Screen' };
export const dynamic = 'force-dynamic';

type FreshnessRow = {
  last_collected_at: string | null;
  profile_count: number | string;
  fresh_profile_count: number | string;
};

export default async function NewsroomPage({
  searchParams,
}: {
  searchParams: Promise<SearchParamsInput>;
}) {
  const requestedParams = await searchParams;
  const ctx = await resolveContext(newsroomTodaySearchParams(requestedParams));
  if (!ctx.landscape) {
    return (
      <main className="grid min-h-dvh place-items-center bg-zinc-950 px-6 text-center text-white">
        <div>
          <h1 className="text-3xl font-semibold">A landscape is required</h1>
          <p className="mt-3 text-zinc-500">Create or select a landscape before starting the newsroom screen.</p>
          <Link href="/settings/companies" className="mt-6 inline-flex rounded-md bg-accent-600 px-4 py-2 text-sm font-semibold">Manage landscapes</Link>
        </div>
      </main>
    );
  }

  const base = analyticsQuery(ctx);
  const generatedAt = new Date();
  const trailing24Hours = newsroomTrailing24Hours(generatedAt);
  const [summary, engagement, recentEngagement, topPosts, freshness] = await Promise.all([
    loadSummary(base),
    loadLeaderboard({ ...base, metric: 'engagementTotal' }),
    loadLeaderboard({
      ...base,
      ...trailing24Hours,
      compare: false,
      metric: 'engagementTotal',
    }),
    loadTopPostsByPlatform({ ...base, perPlatform: 3 }),
    query<FreshnessRow>(({ sql }) => sql`
      WITH latest_settled AS (
        SELECT
          ir.channel_id,
          max(ir.finished_at) AS collected_at
        FROM ingestion_runs ir
        WHERE ir.status IN ('succeeded', 'partial')
          AND ir.finished_at IS NOT NULL
        GROUP BY ir.channel_id
      )
      SELECT
        to_char(max(ls.collected_at) AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS last_collected_at,
        count(*) AS profile_count,
        count(*) FILTER (
          WHERE ls.collected_at >= now() - interval '14 hours'
        ) AS fresh_profile_count
      FROM channels ch
      JOIN landscape_companies lc ON lc.company_id = ch.company_id
      LEFT JOIN latest_settled ls ON ls.channel_id = ch.id
      WHERE lc.landscape_id = ${ctx.landscape!.id}::uuid
        AND ch.active
    `),
  ]);

  const focusCompanyId = summary.data?.focus?.id
    ?? effectiveFocusCompanyId(ctx.focusCompanyId, ctx.companyIds);
  const focusName = summary.data?.focus?.name
    ?? ctx.companies.find((company) => company.id === focusCompanyId)?.name
    ?? ctx.landscape.focusCompanyName
    ?? ctx.landscape.name;
  const scopeLabel = ctx.companyIds.length === 0
    ? `${ctx.landscape.companyCount} companies`
    : ctx.companyIds.length === 1
      ? ctx.companies.find((company) => company.id === ctx.companyIds[0])?.name ?? '1 selected company'
      : `${ctx.companyIds.length} selected companies`;
  const platformLabel = ctx.platforms.length === 0
    ? 'All platforms'
    : ctx.platforms.map((platform) => PLATFORM_LABELS[platform]).join(', ');
  const rangeLabel = formatFullDate(ctx.range.start) === formatFullDate(ctx.range.end)
    ? formatFullDate(ctx.range.start)
    : `${formatFullDate(ctx.range.start)} – ${formatFullDate(ctx.range.end)}`;
  const fresh = freshness.data[0];
  const returnParams = new URLSearchParams(ctx.searchParams.toString());
  returnParams.set('landscape', ctx.landscape.id);
  const errors = [
    ctx.error,
    summary.error,
    engagement.error,
    recentEngagement.error,
    topPosts.error,
    freshness.error,
  ].filter((error): error is string => Boolean(error));

  return (
    <NewsroomDisplay
      landscape={{
        id: ctx.landscape.id,
        name: ctx.landscape.name,
        companyCount: ctx.landscape.companyCount,
      }}
      focusCompanyId={focusCompanyId}
      focusName={focusName}
      scopeLabel={scopeLabel}
      rangeLabel={rangeLabel}
      platformLabel={platformLabel}
      summary={summary.data}
      engagementRows={engagement.data}
      recentEngagementRows={recentEngagement.data}
      topPosts={topPosts.data}
      platforms={ctx.platforms.length > 0 ? ctx.platforms : NEWSROOM_PLATFORMS}
      freshness={{
        lastIngestedAt: fresh?.last_collected_at ?? null,
        profileCount: Number(fresh?.profile_count ?? 0),
        freshProfileCount: Number(fresh?.fresh_profile_count ?? 0),
      }}
      generatedAt={generatedAt.toISOString()}
      errors={errors}
      exitHref={`/cross-channel?${returnParams.toString()}`}
    />
  );
}
