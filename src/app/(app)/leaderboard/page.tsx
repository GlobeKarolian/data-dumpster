import type { Metadata } from 'next';
import type { MetricKey } from '@/lib/types';
import { PageSection } from '@/components/shell/page-section';
import { NoLandscape } from '@/components/common/no-landscape';
import { LeaderboardPanel } from '@/components/overview/leaderboard-panel';
import { resolveContext, analyticsQuery } from '../_lib/context';
import { loadLeaderboard, type SearchParamsInput } from '../_lib/data';

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
  const results = await Promise.all(
    ALL_METRICS.map(async (metric) => {
      const loaded = await loadLeaderboard({ ...base, metric });
      return [metric, loaded] as const;
    }),
  );
  const byMetric = new Map(results);

  return (
    <div className="space-y-6">
      <p className="max-w-3xl text-sm leading-relaxed text-zinc-600 dark:text-zinc-400">
        Every ranking in the landscape, on one page. The dashed line on each chart is the mean of
        every company except the focus company, so a bar that clears it is beating the field rather
        than beating one rival.
      </p>

      {GROUPS.map((group) => (
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
                  focusCompanyId={ctx.focusCompanyId}
                />
              );
            })}
          </div>
        </PageSection>
      ))}
    </div>
  );
}
