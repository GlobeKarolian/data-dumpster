'use client';

import * as React from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { Tag } from 'lucide-react';
import type { TagRow } from '@/lib/metrics/contract';
import { hrefWithGlobalParams } from '@/components/common/use-url-state';
import { percent } from '@/lib/utils';
import { DataTable, type Column } from '@/components/ui/table';
import { MetricLabel } from '@/components/ui/metric-label';
import { EmptyState } from '@/components/ui/empty-state';
import { Tooltip } from '@/components/ui/tooltip';
import { formatMetric } from '@/components/ui/format';

/** Lift is the only column here that is not a raw metric, so it explains itself. */
function LiftCell({ lift }: { lift: number | null }) {
  if (lift === null || !Number.isFinite(lift)) {
    return <span className="text-zinc-400">—</span>;
  }
  const delta = lift - 1;
  const tone =
    Math.abs(delta) < 0.02
      ? 'text-zinc-500'
      : delta > 0
        ? 'text-emerald-700 dark:text-emerald-400'
        : 'text-red-700 dark:text-red-400';
  return <span className={'font-medium ' + tone}>{percent(delta, 0)}</span>;
}

export function TagPerformanceTable({ rows }: { rows: TagRow[] }) {
  const searchParams = useSearchParams();
  const columns: Column<TagRow>[] = React.useMemo(
    () => [
      {
        id: 'tag',
        header: 'Tag',
        sortValue: (r) => r.tag.name,
        // The row is the summary; the name is the door. Clicking through lands
        // on Social Posts filtered to this tag in the same scope and window,
        // where every post behind these numbers is individually inspectable.
        cell: (r) => (
          <Link
            href={hrefWithGlobalParams('/posts', searchParams, { tags: r.tag.id })}
            prefetch={false}
            title={`All posts tagged “${r.tag.name}”`}
            className="group inline-flex items-center gap-2"
          >
            <span
              aria-hidden
              className="h-2 w-2 shrink-0 rounded-full"
              style={{ backgroundColor: r.tag.color ?? '#71717a' }}
            />
            <span className="font-medium text-zinc-900 underline-offset-2 group-hover:underline dark:text-zinc-100">
              {r.tag.name}
            </span>
          </Link>
        ),
      },
      {
        id: 'postCount',
        header: <MetricLabel metric="posts" short align="end" />,
        align: 'right',
        sortValue: (r) => r.postCount,
        cell: (r) => formatMetric(r.postCount, 'posts'),
      },
      {
        id: 'shareOfPosts',
        header: 'Share of posts',
        align: 'right',
        hideBelow: 'md',
        sortValue: (r) => r.shareOfPosts,
        cell: (r) => percent(r.shareOfPosts, 1),
      },
      {
        id: 'engagementTotal',
        header: <MetricLabel metric="engagementTotal" short align="end" />,
        align: 'right',
        sortValue: (r) => r.engagementTotal,
        cell: (r) => formatMetric(r.engagementTotal, 'engagementTotal'),
      },
      {
        id: 'engagementPerPost',
        header: <MetricLabel metric="engagementPerPost" short align="end" />,
        align: 'right',
        sortValue: (r) => r.engagementPerPost,
        cell: (r) => formatMetric(r.engagementPerPost, 'engagementPerPost'),
      },
      {
        id: 'engagementRateByFollower',
        header: <MetricLabel metric="engagementRateByFollower" short align="end" />,
        align: 'right',
        hideBelow: 'lg',
        sortValue: (r) => r.engagementRateByFollower,
        cell: (r) => formatMetric(r.engagementRateByFollower, 'engagementRateByFollower'),
      },
      {
        id: 'lift',
        header: (
          <Tooltip
            wide
            side="bottom"
            align="end"
            content={
              <span className="block space-y-1.5">
                <span className="block font-medium text-zinc-900 dark:text-zinc-100">Lift vs baseline</span>
                <span className="block text-zinc-600 dark:text-zinc-400">
                  How a tagged post performed against the same company’s untagged average over the same
                  window. Plus twenty percent means posts carrying this tag earned a fifth more reaction
                  than that brand’s typical post.
                </span>
                <span className="block text-zinc-500">
                  Blank when the tag has too few posts for the comparison to mean anything.
                </span>
              </span>
            }
          >
            <span tabIndex={0} className="cursor-help border-b border-dotted border-zinc-400">
              Lift
            </span>
          </Tooltip>
        ),
        align: 'right',
        sortValue: (r) => r.lift ?? -Infinity,
        cell: (r) => <LiftCell lift={r.lift} />,
      },
    ],
    [searchParams],
  );

  return (
    <DataTable
      rows={rows}
      columns={columns}
      getRowKey={(r) => r.tag.id}
      caption="Tag performance in the selected window"
      defaultSort={{ id: 'engagementTotal', direction: 'desc' }}
      empty={
        <EmptyState
          compact
          icon={Tag}
          title="No tagged posts in this window"
          description="Tags are applied at ingest time by a keyword rule or by your own model. Define one below and the next ingest will start filling this table."
        />
      }
    />
  );
}
