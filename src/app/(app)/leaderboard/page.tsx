import type { Metadata } from 'next';
import Link from 'next/link';
import { AlertTriangle } from 'lucide-react';
import type { MetricKey } from '@/lib/types';
import { PageSection } from '@/components/shell/page-section';
import { NoLandscape } from '@/components/common/no-landscape';
import { LeaderboardPanel } from '@/components/overview/leaderboard-panel';
import { resolveContext, analyticsQuery } from '../_lib/context';
import {
  loadIngestionCoverage,
  loadLeaderboard,
  type SearchParamsInput,
} from '../_lib/data';
import { effectiveFocusCompanyId } from '@/lib/analytics-scope';
import { platformMetricLabel } from '@/lib/platform-language';
import { CrossChannelTabs } from '@/components/content/cross-channel-tabs';

export const metadata: Metadata = { title: 'Leaderboards' };

const GROUPS: { title: string; description: string; metrics: MetricKey[] }[] = [
  {
    title: 'Audience',
    description:
      'How many people each brand can reach, and how that changed. Size and momentum are different questions and deserve separate charts.',
    metrics: ['audience', 'audienceNetChange'],
  },
  {
    title: 'Output',
    description:
      'Publishing volume and cadence. Read these first: they are the denominator under every efficiency metric further down the page.',
    metrics: ['posts', 'postsPerDay'],
  },
  {
    title: 'Engagement',
    description:
      'Total reaction, average reaction, and the size-neutral rate. Only the last one is fair between a national outlet and a metro daily.',
    metrics: ['engagementTotal', 'engagementPerPost', 'engagementRateByFollower'],
  },
  {
    title: 'Reaction type',
    description:
      'What kind of reaction the content earned. Applause is cheap, conversation is expensive, and amplification is the only one that reaches beyond the existing following.',
    metrics: ['applause', 'conversation', 'amplification'],
  },
];

const ALL_METRICS = GROUPS.flatMap((g) => g.metrics);

export default async function LeaderboardPage({
  searchParams,
}: {
  searchParams: Promise<SearchParamsInput>;
}) {
  const ctx = await resolveContext(await searchParams);
  if (!ctx.landscape) return <NoLandscape reason={ctx.error} />;

  const base = analyticsQuery(ctx);
  const focusCompanyId = effectiveFocusCompanyId(ctx.focusCompanyId, ctx.companyIds);
  const [results, coverageLoaded] = await Promise.all([
    Promise.all(
      ALL_METRICS.map(async (metric) => {
        const loaded = await loadLeaderboard({ ...base, metric });
        return [metric, loaded] as const;
      }),
    ),
    loadIngestionCoverage({
      orgId: ctx.orgId,
      landscapeId: ctx.landscape.id,
      companyIds: ctx.companyIds.length > 0 ? ctx.companyIds : undefined,
      platforms: ctx.platforms.length > 0 ? ctx.platforms : undefined,
      focusCompanyId,
      start: ctx.range.start,
      end: ctx.range.end,
    }),
  ]);
  const byMetric = new Map(results);
  const platform = ctx.platforms.length === 1 ? ctx.platforms[0] : null;
  const coverage = coverageLoaded.data;
  const coverageComplete = Boolean(
    coverage
      && coverage.totalChannels > 0
      && coverage.ingestedChannels === coverage.totalChannels
      && coverage.failedChannels === 0,
  );

  return (
    <div className="space-y-6">
      <CrossChannelTabs />
      <p className="max-w-3xl text-sm leading-relaxed text-zinc-600 dark:text-zinc-400">
        Every ranking in the landscape, on one page. The dashed line on each chart is the mean of
        every company except the focus company, so a bar that clears it is beating the field rather
        than beating one rival. Colored bar segments show each platform&apos;s contribution wherever
        the metric can be added across platforms.
      </p>

      {!coverageComplete ? (
        <div
          role="alert"
          className="flex flex-col gap-3 rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-amber-950 dark:border-amber-900/70 dark:bg-amber-950/30 dark:text-amber-100 sm:flex-row sm:items-start sm:justify-between"
        >
          <div className="flex min-w-0 gap-2.5">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-700 dark:text-amber-400" aria-hidden />
            <div>
              <p className="text-sm font-semibold">
                Rankings are locked until collection is complete
              </p>
              <p className="mt-1 max-w-4xl text-xs leading-relaxed text-amber-800 dark:text-amber-300">
                {coverage
                  ? coverage.ingestedChannels + ' of ' + coverage.totalChannels
                    + ' active profiles cover the selected window. '
                    + coverage.collectingChannels + ' are queued or collecting, '
                    + coverage.neverAttemptedChannels + ' have not started, and '
                    + coverage.failedChannels + ' failed.'
                  : 'Data Dumpster could not verify collection coverage, so it will not publish rankings.'}
                {coverage && coverage.focusTotalChannels > 0
                  && coverage.focusIngestedChannels < coverage.focusTotalChannels
                  ? ' The focus company has ' + coverage.focusIngestedChannels + ' of '
                    + coverage.focusTotalChannels + ' profiles complete for this window.'
                  : ''}
                {' Rankings appear only after every profile is complete, so missing data can never become a fake zero or an understated total.'}
              </p>
            </div>
          </div>
          <Link
            href={'/settings/sources?landscape=' + encodeURIComponent(ctx.landscape.id)}
            className="shrink-0 rounded-md border border-amber-300 bg-white px-3 py-1.5 text-xs font-medium text-amber-900 transition-colors hover:bg-amber-100 dark:border-amber-800 dark:bg-amber-950/50 dark:text-amber-200 dark:hover:bg-amber-900/50"
          >
            Review profile status
          </Link>
        </div>
      ) : null}

      {coverageComplete ? GROUPS.map((group) => (
        <PageSection key={group.title} title={group.title} description={group.description}>
          <div className="grid gap-3 xl:grid-cols-2">
            {group.metrics.map((metric) => {
              const loaded = byMetric.get(metric);
              return (
                <LeaderboardPanel
                  key={metric}
                  metric={metric}
                  rows={loaded?.data ?? []}
                  error={loaded?.error}
                  focusCompanyId={focusCompanyId}
                  showPlatformBreakdown
                  title={platform ? platformMetricLabel(metric, platform) : undefined}
                />
              );
            })}
          </div>
        </PageSection>
      )) : null}
    </div>
  );
}
