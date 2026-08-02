import * as React from 'react';
import Link from 'next/link';
import { PLATFORM_COLORS, PLATFORM_LABELS, type Platform } from '@/lib/types';
import { PageSection } from '@/components/shell/page-section';
import { Panel } from '@/components/common/panel';
import { NoLandscape } from '@/components/common/no-landscape';
import { GlanceRow, ComparisonNote } from '@/components/overview/glance';
import { RedditAccountGlance } from '@/components/overview/reddit-account-glance';
import { CrossChannelGlance } from '@/components/overview/cross-channel-glance';
import { LeaderboardPanel } from '@/components/overview/leaderboard-panel';
import { OverviewBenchmarkPanel } from '@/components/overview/overview-benchmark-panel';
import { PlatformMixPanel } from '@/components/overview/platform-mix';
import { TopPostsPanel } from '@/components/overview/top-posts';
import { TopPostsByChannel } from '@/components/overview/top-posts-by-channel';
import { TimeSeriesChart } from '@/components/charts/time-series-chart';
import { StackedAreaChart } from '@/components/charts/stacked-area-chart';
import { HeatmapGrid } from '@/components/charts/heatmap-grid';
import {
  analyticsQuery, seriesFor, type AppContext,
} from '../_lib/context';
import {
  platformMetricLabel,
  publicationNoun,
  type RedditEntityMix,
} from '@/lib/platform-language';
import { effectiveFocusCompanyId } from '@/lib/analytics-scope';
import {
  loadLeaderboard, loadPostingCadence, loadSummary, loadTimeSeries,
} from '../_lib/data';

export interface OverviewScreenProps {
  ctx: AppContext;
  /** When present the whole screen is scoped to one channel. */
  platform?: Platform;
  /** Reddit user profiles need content metrics, not subreddit-member metrics. */
  redditMode?: RedditEntityMix | null;
  /** Companies with an active Reddit source in the current URL scope. */
  redditTrackedCompanyIds?: string[];
}

/**
 * Cross-channel and per-platform overviews are the same screen with a
 * different filter. Keeping them literally the same component is what
 * guarantees the Instagram page and the cross-channel page cannot quietly
 * disagree about how engagement rate was computed.
 */
export async function OverviewScreen({
  ctx,
  platform,
  redditMode,
  redditTrackedCompanyIds = [],
}: OverviewScreenProps) {
  if (!ctx.landscape) return <NoLandscape reason={ctx.error} />;

  const base = analyticsQuery(ctx, platform ? { platforms: [platform] } : undefined);
  const scope = platform ? ' on ' + PLATFORM_LABELS[platform] : ' across every channel';
  const accent = platform ? PLATFORM_COLORS[platform] : undefined;
  const redditAccountView = platform === 'reddit' && redditMode !== 'subreddit';

  const [
    [summary, audience, posts, engagement, rate, series, voice, cadence],
    redditMetrics,
  ] = await Promise.all([
    Promise.all([
      loadSummary(base),
      loadLeaderboard({ ...base, metric: 'audience' }),
      loadLeaderboard({ ...base, metric: 'posts' }),
      loadLeaderboard({ ...base, metric: 'engagementTotal' }),
      loadLeaderboard({ ...base, metric: 'engagementRateByFollower' }),
      loadTimeSeries({ ...base, metric: 'engagementTotal' }),
      loadTimeSeries({ ...base, metric: 'posts' }),
      loadPostingCadence(base),
    ]),
    redditAccountView
      ? Promise.all([
          loadLeaderboard({ ...base, metric: 'applause' }),
          loadLeaderboard({ ...base, metric: 'conversation' }),
          loadLeaderboard({ ...base, metric: 'engagementPerPost' }),
        ])
      : Promise.resolve(null),
  ]);

  const focusCompanyId =
    summary.data?.focus?.id
    ?? effectiveFocusCompanyId(ctx.focusCompanyId, ctx.companyIds);
  const focusName =
    summary.data?.focus?.name
    ?? ctx.companies.find((company) => company.id === focusCompanyId)?.name
    ?? ctx.landscape.focusCompanyName
    ?? ctx.landscape.name;
  const platformLabels = platform ? {
    audience: platformMetricLabel('audience', platform),
    posts: platformMetricLabel('posts', platform),
    engagementTotal: platformMetricLabel('engagementTotal', platform),
    engagementRateByFollower: platformMetricLabel('engagementRateByFollower', platform),
  } : undefined;
  const publications = platform ? publicationNoun(platform).toLowerCase() : 'posts';
  const publication = platform ? publicationNoun(platform, false) : 'Post';
  const trackedRedditCompanies = new Set(redditTrackedCompanyIds);
  const redditRows = <T extends { company: { id: string } }>(rows: T[]): T[] =>
    redditAccountView
      ? rows.filter((row) => trackedRedditCompanies.has(row.company.id))
      : rows;
  const redditPosts = redditRows(posts.data);
  const redditScore = redditRows(redditMetrics?.[0].data ?? []);
  const redditComments = redditRows(redditMetrics?.[1].data ?? []);
  const redditEngagementPerPost = redditRows(redditMetrics?.[2].data ?? []);
  const redditCanBenchmark = trackedRedditCompanies.size > 1;
  const scopedCompanyCount = ctx.companyIds.length > 0
    ? ctx.companyIds.length
    : ctx.companies.length;
  const chartSeries = redditAccountView
    ? seriesFor(ctx).filter((item) => trackedRedditCompanies.has(item.key))
    : seriesFor(ctx);
  const redditMetricError = redditMetrics
    ?.map((metric) => metric.error)
    .find((error): error is string => Boolean(error)) ?? null;

  return (
    <div className="space-y-4">
      {platform ? (
        <PageSection
          title={focusName + ' at a glance'}
          description={
            'How ' + focusName + ' performed' + scope + ' in the selected window, and how each figure ' +
            'moved against the equal-length window before it.'
          }
        >
          {redditAccountView ? (
            <>
              <div className="mb-3 rounded-lg border border-orange-200 bg-orange-50 px-4 py-3 dark:border-orange-900/60 dark:bg-orange-950/20">
                <p className="text-xs font-semibold text-orange-950 dark:text-orange-200">
                  Reddit user account performance
                </p>
                <p className="mt-1 text-[11px] leading-relaxed text-orange-900/75 dark:text-orange-300/75">
                  Reddit does not expose a trustworthy public follower total for user profiles.
                  This view measures their submissions, vote-fuzzed post score, comments,
                  crossposts, and engagement per post instead of inventing a member rate.
                </p>
              </div>
              <RedditAccountGlance
                focusCompanyId={focusCompanyId}
                posts={redditPosts}
                score={redditScore}
                comments={redditComments}
                engagementPerPost={redditEngagementPerPost}
                color={accent}
              />
            </>
          ) : (
            <GlanceRow summary={summary.data} color={accent} labels={platformLabels} />
          )}
          <ComparisonNote summary={summary.data} />
          {summary.error || redditMetricError ? (
            <p className="mt-2 text-[11px] text-red-600 dark:text-red-400">
              {'Summary could not be computed: ' + (summary.error ?? redditMetricError)}
            </p>
          ) : null}
        </PageSection>
      ) : (
        <>
          <CrossChannelGlance
            summary={summary.data}
            focusName={focusName}
            error={summary.error}
          />
          <TopPostsByChannel
            posts={summary.data?.topPosts ?? []}
            error={summary.error}
            landscapeId={ctx.landscape.id}
            title={`${focusName}'s Top Posts by Channel`}
          />
        </>
      )}

      {platform ? (
        <PageSection
          title={redditAccountView && !redditCanBenchmark ? 'Account performance' : 'Against the competitive set'}
          description={
            redditAccountView
              ? 'Only companies with an active Reddit account are included. Unconnected companies are unavailable, not zero.'
              : 'Each bar is one company. The dashed line is the mean of everyone other than the focus company, which is the only reading that turns a rank into a judgment.'
          }
        >
          {redditAccountView && !redditCanBenchmark ? (
            <div className="mb-3 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-zinc-200 bg-white px-4 py-3 dark:border-zinc-800 dark:bg-zinc-900/40">
              <div>
                <p className="text-xs font-semibold text-zinc-900 dark:text-zinc-100">
                  {'Only ' + trackedRedditCompanies.size + ' of ' + scopedCompanyCount
                    + (scopedCompanyCount === 1 ? ' company' : ' companies')
                    + ' has a Reddit account connected.'}
                </p>
                <p className="mt-1 text-[11px] text-zinc-500">
                  Add competitor user profiles to unlock a real benchmark and landscape average.
                </p>
              </div>
              <Link
                href="/settings/sources"
                className="text-xs font-semibold text-accent-600 hover:underline dark:text-accent-500"
              >
                Add Reddit accounts
              </Link>
            </div>
          ) : null}
          <div className="grid gap-3 xl:grid-cols-2">
            {redditAccountView ? (
              <>
                <LeaderboardPanel
                  metric="posts"
                  rows={redditPosts}
                  error={posts.error}
                  focusCompanyId={focusCompanyId}
                  color={accent}
                  title="Posts"
                  showCompetitorAverage={redditCanBenchmark}
                />
                <LeaderboardPanel
                  metric="applause"
                  rows={redditScore}
                  error={redditMetrics?.[0].error}
                  focusCompanyId={focusCompanyId}
                  color={accent}
                  title="Total Score"
                  showCompetitorAverage={redditCanBenchmark}
                />
                <LeaderboardPanel
                  metric="conversation"
                  rows={redditComments}
                  error={redditMetrics?.[1].error}
                  focusCompanyId={focusCompanyId}
                  color={accent}
                  title="Comments"
                  showCompetitorAverage={redditCanBenchmark}
                />
                <LeaderboardPanel
                  metric="engagementPerPost"
                  rows={redditEngagementPerPost}
                  error={redditMetrics?.[2].error}
                  focusCompanyId={focusCompanyId}
                  color={accent}
                  title="Engagement per Post"
                  showCompetitorAverage={redditCanBenchmark}
                />
              </>
            ) : (
              <>
                <LeaderboardPanel
                  metric="audience"
                  rows={audience.data}
                  error={audience.error}
                  focusCompanyId={focusCompanyId}
                  color={accent}
                  title={platformMetricLabel('audience', platform)}
                />
                <LeaderboardPanel
                  metric="posts"
                  rows={posts.data}
                  error={posts.error}
                  focusCompanyId={focusCompanyId}
                  color={accent}
                  title={platformMetricLabel('posts', platform)}
                />
                <LeaderboardPanel
                  metric="engagementTotal"
                  rows={engagement.data}
                  error={engagement.error}
                  focusCompanyId={focusCompanyId}
                  color={accent}
                />
                <LeaderboardPanel
                  metric="engagementRateByFollower"
                  rows={rate.data}
                  error={rate.error}
                  focusCompanyId={focusCompanyId}
                  color={accent}
                  title={platformMetricLabel('engagementRateByFollower', platform)}
                />
              </>
            )}
          </div>
        </PageSection>
      ) : (
        <>
          <OverviewBenchmarkPanel
            metric="audience"
            rows={audience.data}
            error={audience.error}
            focusCompanyId={focusCompanyId}
            focusName={focusName}
          />
          <OverviewBenchmarkPanel
            metric="posts"
            rows={posts.data}
            error={posts.error}
            focusCompanyId={focusCompanyId}
            focusName={focusName}
          />
          <OverviewBenchmarkPanel
            metric="engagementTotal"
            rows={engagement.data}
            secondaryRows={rate.data}
            error={engagement.error ?? rate.error}
            focusCompanyId={focusCompanyId}
            focusName={focusName}
          />
        </>
      )}

      <PageSection
        title="Additional analysis"
        description="Data Dumpster additions beyond the Rival IQ baseline."
      >
        <div className="space-y-3">
          <div className={redditAccountView ? '' : 'grid gap-3 xl:grid-cols-3'}>
            <Panel
              className={redditAccountView ? undefined : 'xl:col-span-2'}
              metric="engagementTotal"
              title="Engagement over time"
              description="Click a company in the legend to drop it out of the chart."
              error={series.error}
            >
              <TimeSeriesChart
                data={series.data.series}
                series={chartSeries}
                metric="engagementTotal"
                granularity={series.data.granularity}
              />
            </Panel>
            {redditAccountView ? null : (
              <PlatformMixPanel summary={summary.data} error={summary.error} />
            )}
          </div>

          <div className={redditAccountView && !redditCanBenchmark ? '' : 'grid gap-3 xl:grid-cols-2'}>
            {redditAccountView && !redditCanBenchmark ? null : (
              <Panel
                metric="shareOfVoice"
                title="Share of voice over time"
                description="Each bucket normalized to one hundred percent, so this reads as who owned the conversation rather than how busy the week was."
                error={voice.error}
                note="Entirely dependent on who is in this landscape: adding or removing a company changes everyone’s share without anyone changing behavior."
              >
                <StackedAreaChart
                  data={voice.data.series}
                  series={chartSeries}
                  metric="posts"
                  percentage
                  granularity={voice.data.granularity}
                />
              </Panel>
            )}
            <Panel
              title={publication + ' cadence'}
              description={'When the landscape publishes, by day and hour. Darker cells carry more ' + publications + '.'}
              error={cadence.error}
            >
              <HeatmapGrid cells={cadence.data} color={accent ?? '#C8102E'} />
            </Panel>
          </div>
        </div>
      </PageSection>

      {platform ? (
        <TopPostsPanel
          posts={summary.data?.topPosts ?? []}
          error={summary.error}
          title={'Top ' + publications + ' on ' + PLATFORM_LABELS[platform]}
          platform={platform}
          landscapeId={ctx.landscape.id}
        />
      ) : null}

    </div>
  );
}
