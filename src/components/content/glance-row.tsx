import * as React from 'react';
import type { AtAGlance } from '@/lib/metrics/content-analysis';
import { cn } from '@/lib/utils';
import { hour } from './insight';

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
    <div className="px-4 py-3">
      <p className="text-[11px] uppercase tracking-wide text-zinc-500 dark:text-zinc-400">{label}</p>
      <p className={cn(
        'pb-num mt-1 text-2xl font-medium tabular-nums tracking-tight',
        worse ? 'text-zinc-900 dark:text-zinc-50' : 'text-zinc-900 dark:text-zinc-50',
      )}
      >
        {value}
      </p>
      <p className="mt-0.5 text-[11px] text-zinc-500 dark:text-zinc-400">{comparison}</p>
    </div>
  );
}

export function GlanceRow({ glance, focusName }: { glance: AtAGlance; focusName: string | null }) {
  const g = glance;
  const pctStr = (n: number) => (n * 100).toFixed(n < 0.01 ? 3 : 2) + '%';

  return (
    <div className="grid divide-y divide-zinc-100 sm:grid-cols-2 sm:divide-y-0 lg:grid-cols-4 dark:divide-zinc-800/60 lg:[&>*+*]:border-l lg:[&>*+*]:border-zinc-100 dark:lg:[&>*+*]:border-zinc-800/60">
      <Stat
        label={(focusName ? 'Your' : 'Focus') + ' posts per day'}
        value={g.postsPerDay.toFixed(1)}
        comparison={'Landscape avg ' + g.landscapePostsPerDay.toFixed(1)}
      />
      <Stat
        label="Your eng. rate"
        value={pctStr(g.engagementRateByFollower)}
        comparison={'Landscape ' + pctStr(g.landscapeEngagementRate)}
        worse={g.engagementRateByFollower < g.landscapeEngagementRate}
      />
      <Stat
        label="Your posts with hashtags"
        value={(g.pctWithHashtags * 100).toFixed(1) + '%'}
        comparison={'Landscape ' + (g.landscapePctWithHashtags * 100).toFixed(1) + '%'}
      />
      <Stat
        label="Your top hour"
        value={hour(g.topHour)}
        comparison={'Landscape top ' + hour(g.landscapeTopHour)}
      />
    </div>
  );
}
