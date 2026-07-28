import * as React from 'react';
import { PLATFORM_COLORS, PLATFORM_LABELS, type Platform } from '@/lib/types';
import { PageSection } from '@/components/shell/page-section';
import { Panel } from '@/components/common/panel';
import { NoLandscape } from '@/components/common/no-landscape';
import { GlanceRow, ComparisonNote } from '@/components/overview/glance';
import { LeaderboardPanel } from '@/components/overview/leaderboard-panel';
import { PlatformMixPanel } from '@/components/overview/platform-mix';
import { TopPostsPanel } from '@/components/overview/top-posts';
import { TimeSeriesChart } from '@/components/charts/time-series-chart';
import { StackedAreaChart } from '@/components/charts/stacked-area-chart';
import { HeatmapGrid } from '@/components/charts/heatmap-grid';
import {
  analyticsQuery, seriesFor, type AppContext,
} from '../_lib/context';
import {
  loadLeaderboard, loadPostingCadence, loadSummary, loadTimeSeries,
} from '../_lib/data';

export interface OverviewScreenProps {
  ctx: AppContext;
  /** When present the whole screen is scoped to one channel. */
  platform?: Platform;
}

/**
 * Cross-channel and per-platform overviews are the same screen with a
 * different filter. Keeping them literally the same component is what
 * guarantees the Instagram page and the cross-channel page cannot quietly
 * disagree about how engagement rate was computed.
 */
export async function OverviewScreen({ ctx, platform }: OverviewScreenProps) {
  if (!ctx.landscape) return <NoLandscape reason={ctx.error} />;

  const base = analyticsQuery(ctx, platform ? { platforms: [platform] } : undefined);
  const scope = platform ? ' on ' + PLATFORM_LABELS[platform] : ' across every channel';
  const accent = platform ? PLATFORM_COLORS[platform] : undefined;

  const [summary, audience, posts, engagement, rate, series, voice, cadence] = await Promise.all([
    loadSummary(base),
    loadLeaderboard({ ...base, metric: 'audience' }),
    loadLeaderboard({ ...base, metric: 'posts' }),
    loadLeaderboard({ ...base, metric: 'engagementTotal' }),
    loadLeaderboard({ ...base, metric: 'engagementRateByFollower' }),
    loadTimeSeries({ ...base, metric: 'engagementTotal' }),
    loadTimeSeries({ ...base, metric: 'posts' }),
    loadPostingCadence(base),
  ]);

  const focusName = summary.data?.focus?.name ?? ctx.landscape.focusCompanyName ?? ctx.landscape.name;

  return (
    <div className="space-y-6">
      <PageSection
        title={focusName + ' at a glance'}
        description={
          'How ' + focusName + ' performed' + scope + ' in the selected window, and how each figure ' +
          'moved against the equal-length window before it.'
        }
      >
        <GlanceRow summary={summary.data} color={accent} />
        <ComparisonNote summary={summary.data} />
        {summary.error ? (
          <p className="mt-2 text-[11px] text-red-600 dark:text-red-400">
            {'Summary could not be computed: ' + summary.error}
          </p>
        ) : null}
      </PageSection>

      <PageSection
        title="Against the competitive set"
        description="Each bar is one company. The dashed line is the mean of everyone other than the focus company, which is the only reading that turns a rank into a judgment."
      >
        <div className="grid gap-3 xl:grid-cols-2">
          <LeaderboardPanel
            metric="audience"
            rows={audience.data}
            error={audience.error}
            focusCompanyId={ctx.focusCompanyId}
            color={accent}
          />
          <LeaderboardPanel
            metric="posts"
            rows={posts.data}
            error={posts.error}
            focusCompanyId={ctx.focusCompanyId}
            color={accent}
          />
          <LeaderboardPanel
            metric="engagementTotal"
            rows={engagement.data}
            error={engagement.error}
            focusCompanyId={ctx.focusCompanyId}
            color={accent}
          />
          <LeaderboardPanel
            metric="engagementRateByFollower"
            rows={rate.data}
            error={rate.error}
            focusCompanyId={ctx.focusCompanyId}
            color={accent}
          />
        </div>
      </PageSection>

      <div className="grid gap-3 xl:grid-cols-3">
        <Panel
          className="xl:col-span-2"
          metric="engagementTotal"
          title="Engagement over time"
          description="Click a company in the legend to drop it out of the chart."
          error={series.error}
        >
          <TimeSeriesChart
            data={series.data.series}
            series={seriesFor(ctx)}
            metric="engagementTotal"
            granularity={series.data.granularity}
          />
        </Panel>
        <PlatformMixPanel summary={summary.data} error={summary.error} />
      </div>

      <div className="grid gap-3 xl:grid-cols-2">
        <Panel
          metric="shareOfVoice"
          title="Share of voice over time"
          description="Each bucket normalized to one hundred percent, so this reads as who owned the conversation rather than how busy the week was."
          error={voice.error}
          note="Entirely dependent on who is in this landscape: adding or removing a company changes everyone’s share without anyone changing behavior."
        >
          <StackedAreaChart
            data={voice.data.series}
            series={seriesFor(ctx)}
            metric="posts"
            percentage
            granularity={voice.data.granularity}
          />
        </Panel>
        <Panel
          title="Posting cadence"
          description="When the landscape publishes, by day and hour. Darker cells carry more posts."
          error={cadence.error}
        >
          <HeatmapGrid cells={cadence.data} color={accent ?? '#C8102E'} />
        </Panel>
      </div>

      <TopPostsPanel
        posts={summary.data?.topPosts ?? []}
        error={summary.error}
        title={platform ? 'Top posts on ' + PLATFORM_LABELS[platform] : 'Top post by channel'}
      />

    </div>
  );
}
