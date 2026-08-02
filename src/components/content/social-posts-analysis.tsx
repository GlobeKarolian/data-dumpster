import * as React from 'react';
import type { ContentAnalysis } from '@/lib/metrics/content-analysis';
import {
  PLATFORM_COLORS,
  PLATFORM_LABELS,
  type Platform,
} from '@/lib/types';
import { platformMetricLabel, publicationNoun } from '@/lib/platform-language';
import { Panel } from '@/components/common/panel';
import { GlanceRow } from './glance-row';
import { DimensionTable } from './dimension-table';
import { DimensionBreakdown } from './dimension-breakdown';
import { TimesChart } from './times-chart';
import {
  ActivitySummary,
  ActivityTable,
  ActivityTrends,
} from './activity-analysis';
import {
  topicsInsight,
  hashtagsInsight,
  typesInsight,
  channelsInsight,
  timesInsight,
  hour,
} from './insight';

const TYPE_COLORS: Record<string, string> = {
  link: '#2563EB',
  photo: '#D97706',
  video: '#7C3AED',
  reel: '#DB2777',
  short: '#DB2777',
  carousel: '#65A30D',
  text: '#52525B',
  story: '#0D9488',
  live: '#DC2626',
  poll: '#0891B2',
  repost: '#4F46E5',
  article: '#9333EA',
  other: '#71717A',
};

function drilldownHref(
  baseSearchParams: string,
  patch: Record<string, string | null>,
): string {
  const next = new URLSearchParams(baseSearchParams);
  next.delete('page');
  for (const [key, value] of Object.entries(patch)) {
    if (value) next.set(key, value);
    else next.delete(key);
  }
  const query = next.toString();
  return query ? `/posts?${query}` : '/posts';
}

function titleCase(value: string): string {
  return value
    .replace(/[_-]+/g, ' ')
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function platformLabel(key: string): string {
  return Object.prototype.hasOwnProperty.call(PLATFORM_LABELS, key)
    ? PLATFORM_LABELS[key as Platform]
    : titleCase(key);
}

function platformColor(key: string): string | undefined {
  return Object.prototype.hasOwnProperty.call(PLATFORM_COLORS, key)
    ? PLATFORM_COLORS[key as Platform]
    : undefined;
}

export function SocialPostsGlance({
  analysis,
  focusName,
  platform,
}: {
  analysis: ContentAnalysis;
  focusName: string | null;
  platform?: Platform;
}) {
  const showBenchmark = platform !== 'reddit' || analysis.activity.length > 1;
  return (
    <Panel title={`${focusName ?? 'Focus company'} at a glance`}>
      <GlanceRow
        glance={analysis.glance}
        focusName={focusName}
        platform={platform}
        showBenchmark={showBenchmark}
      />
    </Panel>
  );
}

export function SocialPostsAnalysis({
  analysis,
  focusName,
  platform,
  searchParams,
}: {
  analysis: ContentAnalysis;
  focusName: string | null;
  platform?: Platform;
  searchParams: string;
}) {
  const publications = platform ? publicationNoun(platform).toLowerCase() : 'posts';
  const publicationLabel = platform ? publicationNoun(platform) : 'Posts';
  const hasAudienceRate = platform !== 'reddit';
  const performanceMetric = hasAudienceRate
    ? 'engagementRateByFollower' as const
    : 'engagementPerPost' as const;
  const rateLabel = platform === 'reddit'
    ? 'Engagement per Post'
    : platform
    ? platformMetricLabel('engagementRateByFollower', platform)
    : 'Eng. rate by follower';
  const subject = focusName ?? 'Focus company';
  const showBenchmark = platform !== 'reddit' || analysis.activity.length > 1;
  const companyCount = platform === 'reddit'
    ? Math.max(1, analysis.activity.length)
    : analysis.glance.landscapePostsPerDay > 0
    ? Math.max(
      1,
      Math.round(
        analysis.totalPosts
        / analysis.days
        / analysis.glance.landscapePostsPerDay,
      ),
    )
    : Math.max(1, analysis.activity.length);
  const channelHref = (key: string) =>
    drilldownHref(searchParams, { platforms: key });
  const typeHref = (key: string) =>
    drilldownHref(searchParams, { types: key });

  return (
    <div className="space-y-4">
      <section
        className="grid items-start gap-3 xl:grid-cols-2"
        aria-label="Activity and engagement"
      >
        <Panel title="Activity & Engagement" bodyClassName="p-0">
          <ActivitySummary
            glance={analysis.glance}
            rows={analysis.activity}
            totalPosts={analysis.totalPosts}
            companyCount={companyCount}
            publicationLabel={publicationLabel}
            rateLabel={rateLabel}
            performanceMetric={performanceMetric}
            showBenchmark={showBenchmark}
          />
          <ActivityTable
            rows={analysis.activity}
            publicationLabel={publicationLabel}
            rateLabel={rateLabel}
            performanceMetric={performanceMetric}
          />
        </Panel>
        <Panel
          title="Activity & Engagement per Day"
          description={showBenchmark
            ? `${subject} compared with the per-company landscape average.`
            : `${subject} over time. Add a competitor Reddit account to unlock a benchmark.`}
        >
          <ActivityTrends
            points={analysis.activityByDay}
            focusName={subject}
            publicationLabel={publicationLabel}
            rateLabel={rateLabel}
            performanceMetric={performanceMetric}
            showBenchmark={showBenchmark}
          />
        </Panel>
      </section>

      <section
        className="grid items-start gap-3 xl:grid-cols-2"
        aria-label="Popular topics and hashtags"
      >
        <Panel
          title="Popular Topics"
          description={hasAudienceRate
            ? topicsInsight(analysis, focusName, publications)
            : 'Topics are compared by usage and engagement per post; Reddit user profiles do not expose a public follower rate.'}
          bodyClassName="p-0"
        >
          <DimensionTable
            rows={analysis.topics}
            keyLabel="Topic"
            focusName={focusName}
            publicationLabel={publicationLabel}
            rateLabel={rateLabel}
            performanceMetric={performanceMetric}
            usedLabel="Topics in your posts"
            unusedLabel="Topics not in your posts"
            hrefForKey={(key) => drilldownHref(searchParams, { q: key })}
          />
        </Panel>

        <Panel
          title="Hashtags"
          description={hasAudienceRate
            ? hashtagsInsight(analysis, focusName)
            : 'Hashtags are compared by usage and engagement per post; Reddit user profiles do not expose a public follower rate.'}
          bodyClassName="p-0"
        >
          <DimensionTable
            rows={analysis.hashtags}
            keyLabel="Hashtag"
            focusName={focusName}
            publicationLabel={publicationLabel}
            rateLabel={rateLabel}
            performanceMetric={performanceMetric}
            usedLabel="Hashtags in your posts"
            unusedLabel="Hashtags not in your posts"
            hrefForKey={(key) => drilldownHref(searchParams, { q: key })}
          />
        </Panel>
      </section>

      <section aria-label="Post channels">
        <Panel
          title="Post Channels"
          description={hasAudienceRate
            ? channelsInsight(analysis, focusName, publications)
            : 'Submission activity and engagement per post across the connected Reddit accounts.'}
          bodyClassName="p-0"
        >
          <DimensionBreakdown
            rows={analysis.channels}
            focusName={subject}
            publicationLabel={publicationLabel}
            rateLabel={rateLabel}
            performanceMetric={performanceMetric}
            days={analysis.days}
            companyCount={companyCount}
            leftTitle="Your Activity by Channel"
            rightTitle={showBenchmark
              ? 'Landscape Activity and Engagement by Channel'
              : 'Account Activity and Engagement by Channel'}
            hrefForKey={channelHref}
            labelForKey={platformLabel}
            colorForKey={platformColor}
          />
        </Panel>
      </section>

      <section aria-label="Post types">
        <Panel
          title="Post Types"
          description={hasAudienceRate
            ? typesInsight(analysis, focusName, publications)
            : 'Submission formats compared by activity and engagement per post.'}
          bodyClassName="p-0"
        >
          <DimensionBreakdown
            rows={analysis.postTypes}
            focusName={subject}
            publicationLabel={publicationLabel}
            rateLabel={rateLabel}
            performanceMetric={performanceMetric}
            days={analysis.days}
            companyCount={companyCount}
            leftTitle="Your Activity by Post Type"
            rightTitle={showBenchmark
              ? 'Landscape Activity and Engagement by Post Type'
              : 'Account Activity and Engagement by Post Type'}
            hrefForKey={typeHref}
            labelForKey={titleCase}
            colorForKey={(key) => TYPE_COLORS[key]}
          />
        </Panel>
      </section>

      <section aria-label="Post times">
        <Panel
          title="Post Times"
          description={hasAudienceRate
            ? timesInsight(analysis.byHour, analysis.glance.topHour, focusName)
            : `${subject} publishes most at ${hour(analysis.glance.topHour)}.`}
          bodyClassName="p-0"
        >
          <div className="grid gap-px bg-zinc-200 xl:grid-cols-2 dark:bg-zinc-800">
            <div className="bg-white dark:bg-zinc-900">
              <TimesChart
                data={analysis.byHour}
                kind="hour"
                metric="activity"
                focusName={subject}
                publicationLabel={publicationLabel}
                days={analysis.days}
                companyCount={companyCount}
                showBenchmark={showBenchmark}
              />
            </div>
            <div className="bg-white dark:bg-zinc-900">
              <TimesChart
                data={analysis.byWeekday}
                kind="weekday"
                metric="activity"
                focusName={subject}
                publicationLabel={publicationLabel}
                days={analysis.days}
                companyCount={companyCount}
                showBenchmark={showBenchmark}
              />
            </div>
            <div className="bg-white dark:bg-zinc-900">
              <TimesChart
                data={analysis.byHour}
                kind="hour"
                metric={hasAudienceRate ? 'rate' : 'engagementPerPost'}
                focusName={subject}
                publicationLabel={publicationLabel}
                days={analysis.days}
                companyCount={companyCount}
                showBenchmark={showBenchmark}
              />
            </div>
            <div className="bg-white dark:bg-zinc-900">
              <TimesChart
                data={analysis.byWeekday}
                kind="weekday"
                metric={hasAudienceRate ? 'rate' : 'engagementPerPost'}
                focusName={subject}
                publicationLabel={publicationLabel}
                days={analysis.days}
                companyCount={companyCount}
                showBenchmark={showBenchmark}
              />
            </div>
          </div>
        </Panel>
      </section>
    </div>
  );
}
