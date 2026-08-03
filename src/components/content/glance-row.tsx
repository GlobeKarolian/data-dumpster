import * as React from 'react';
import type { AtAGlance } from '@/lib/metrics/content-analysis';
import { cn } from '@/lib/utils';
import { hour } from './insight';
import type { Platform } from '@/lib/types';
import { platformMetricLabel, publicationNoun } from '@/lib/platform-language';

/**
 * The four headline figures, each with the landscape average beneath it.
 *
 * The comparison line is not optional decoration. A newsroom posting fifteen
 * times a day has no idea whether that is a lot until it sees that the market
 * average is six, and "0.220%" means nothing until "landscape 0.323%" sits
 * under it and reveals that the answer is below average.
 */
function Stat({
  label,
  value,
  comparison,
  worse,
}: {
  label: string;
  value: string;
  comparison: string;
  worse?: boolean;
}) {
  return (
    <div className="px-5 py-5">
      <p className="text-[10px] font-semibold uppercase tracking-wider text-zinc-500 dark:text-zinc-400">
        {label}
      </p>
      <p className={cn(
        'pb-num mt-2 text-3xl font-semibold tabular-nums tracking-tight',
        worse ? 'text-zinc-900 dark:text-zinc-50' : 'text-zinc-900 dark:text-zinc-50',
      )}
      >
        {value}
      </p>
      <p className="mt-1 text-[11px] text-zinc-500 dark:text-zinc-400">{comparison}</p>
    </div>
  );
}

export function GlanceRow({
  glance,
  platform,
  showBenchmark = true,
}: {
  glance: AtAGlance;
  focusName: string | null;
  platform?: Platform;
  showBenchmark?: boolean;
}) {
  const g = glance;
  const pctStr = (n: number | null) =>
    (n === null ? '—' : (n * 100).toFixed(n < 0.01 ? 3 : 2) + '%');
  const compact = (n: number) => n.toLocaleString('en-US', {
    maximumFractionDigits: n < 10 ? 1 : 0,
  });
  const publications = platform ? publicationNoun(platform).toLowerCase() : 'posts';
  const usesEngagementPerPost = platform === 'reddit';
  const performanceLabel = usesEngagementPerPost
    ? platformMetricLabel('engagementPerPost', platform)
    : platform
    ? platformMetricLabel('engagementRateByFollower', platform).toLowerCase()
    : 'eng. rate';
  const noBenchmark = 'Add competitor accounts to benchmark';

  return (
    <div className="grid divide-y divide-zinc-100 xl:grid-cols-4 xl:divide-y-0 dark:divide-zinc-800/60 xl:[&>*+*]:border-l xl:[&>*+*]:border-zinc-100 dark:xl:[&>*+*]:border-zinc-800/60">
      <Stat
        label={'Your ' + publications + ' per day'}
        value={g.postsPerDay.toFixed(1)}
        comparison={showBenchmark
          ? 'Landscape Avg.: ' + g.landscapePostsPerDay.toFixed(1)
          : noBenchmark}
      />
      <Stat
        label={'Your ' + performanceLabel}
        value={usesEngagementPerPost
          ? compact(g.engagementPerPost)
          : pctStr(g.engagementRateByFollower)}
        comparison={showBenchmark
          ? 'Post Avg.: ' + (usesEngagementPerPost
            ? compact(g.landscapeEngagementPerPost)
            : pctStr(g.landscapeEngagementRate))
          : noBenchmark}
        // Only claim "worse than the market" when both sides were measured.
        worse={!usesEngagementPerPost
          && g.engagementRateByFollower !== null
          && g.landscapeEngagementRate !== null
          && g.engagementRateByFollower < g.landscapeEngagementRate}
      />
      <Stat
        label={'Your ' + publications + ' with hashtags'}
        value={(g.pctWithHashtags * 100).toFixed(1) + '%'}
        comparison={showBenchmark
          ? 'Post Avg.: ' + (g.landscapePctWithHashtags * 100).toFixed(1) + '%'
          : noBenchmark}
      />
      <Stat
        label="Your top hour of day"
        value={hour(g.topHour) + ' ET'}
        comparison={showBenchmark
          ? 'Landscape Top: ' + hour(g.landscapeTopHour) + ' ET'
          : noBenchmark}
      />
    </div>
  );
}
