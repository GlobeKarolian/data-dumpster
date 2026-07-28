'use client';

import * as React from 'react';
import { ExternalLink } from 'lucide-react';
import type { PostDto, SortKey } from '@/lib/metrics/contract';
import { PLATFORM_LABELS } from '@/lib/types';
import { Badge, PlatformBadge } from '@/components/ui/badge';
import { DataTable, type Column, type SortDirection } from '@/components/ui/table';
import { MetricLabel } from '@/components/ui/metric-label';
import { formatDateTime, formatMetric, truncate } from '@/components/ui/format';
import { OUTLIER_THRESHOLD, OutlierBadge } from './post-card';

export interface PostsTableProps {
  posts: PostDto[];
  sort: SortKey;
  direction: SortDirection;
  onSortChange: (sort: SortKey, direction: SortDirection) => void;
  empty?: React.ReactNode;
}

const SORTABLE = new Set<string>([
  'postedAt', 'engagementTotal', 'engagementRateByFollower',
  'applause', 'conversation', 'amplification', 'views',
]);

/**
 * Server-sorted table. Sorting has to happen in Postgres because the explorer
 * pages through tens of thousands of posts; sorting the visible 25 would answer
 * a different and much less useful question.
 */
export function PostsTable({ posts, sort, direction, onSortChange, empty }: PostsTableProps) {
  const columns: Column<PostDto>[] = React.useMemo(
    () => [
      {
        id: 'postedAt',
        sortable: true,
        header: 'Posted',
        width: 'w-28',
        cell: (p) => <span className="pb-num whitespace-nowrap text-zinc-500">{formatDateTime(p.postedAt)}</span>,
      },
      {
        id: 'company',
        header: 'Company',
        width: 'w-40',
        cell: (p) => (
          <span className="block truncate font-medium text-zinc-900 dark:text-zinc-100">{p.company.name}</span>
        ),
      },
      {
        id: 'platform',
        header: 'Channel',
        width: 'w-28',
        hideBelow: 'md',
        cell: (p) => <PlatformBadge platform={p.platform} />,
      },
      {
        id: 'text',
        header: 'Post',
        cell: (p) => (
          <div className="min-w-0 max-w-xl">
            <p className="truncate text-zinc-700 dark:text-zinc-300">
              {p.text ? truncate(p.text, 140) : <span className="italic text-zinc-400">No caption</span>}
            </p>
            {p.tags.length > 0 || (p.outlierScore !== null && p.outlierScore > OUTLIER_THRESHOLD) ? (
              <div className="mt-1 flex flex-wrap items-center gap-1">
                {p.outlierScore !== null && p.outlierScore > OUTLIER_THRESHOLD ? (
                  <OutlierBadge score={p.outlierScore} />
                ) : null}
                {p.tags.slice(0, 3).map((t) => (
                  <Badge key={t.id} tone="outline">{t.name}</Badge>
                ))}
              </div>
            ) : null}
          </div>
        ),
      },
      {
        id: 'type',
        header: 'Type',
        width: 'w-20',
        hideBelow: 'lg',
        cell: (p) => <span className="capitalize text-zinc-500">{p.type}</span>,
      },
      {
        id: 'applause',
        sortable: true,
        header: <MetricLabel metric="applause" short align="end" />,
        align: 'right',
        hideBelow: 'lg',
        cell: (p) => formatMetric(p.applause, 'applause'),
      },
      {
        id: 'conversation',
        sortable: true,
        header: <MetricLabel metric="conversation" short align="end" />,
        align: 'right',
        hideBelow: 'xl',
        cell: (p) => formatMetric(p.conversation, 'conversation'),
      },
      {
        id: 'amplification',
        sortable: true,
        header: <MetricLabel metric="amplification" short align="end" />,
        align: 'right',
        hideBelow: 'xl',
        cell: (p) => formatMetric(p.amplification, 'amplification'),
      },
      {
        id: 'engagementTotal',
        sortable: true,
        header: <MetricLabel metric="engagementTotal" short align="end" />,
        align: 'right',
        cell: (p) => (
          <span className="font-medium text-zinc-900 dark:text-zinc-100">
            {formatMetric(p.engagementTotal, 'engagementTotal')}
          </span>
        ),
      },
      {
        id: 'engagementRateByFollower',
        sortable: true,
        header: <MetricLabel metric="engagementRateByFollower" short align="end" />,
        align: 'right',
        hideBelow: 'md',
        cell: (p) => formatMetric(p.engagementRateByFollower, 'engagementRateByFollower'),
      },
      {
        id: 'link',
        header: <span className="sr-only">Original</span>,
        width: 'w-8',
        align: 'center',
        cell: (p) =>
          p.permalink ? (
            <a
              href={p.permalink}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex text-zinc-400 transition-colors hover:text-accent-600"
              aria-label={'Open the original ' + PLATFORM_LABELS[p.platform] + ' post'}
            >
              <ExternalLink className="h-3.5 w-3.5" aria-hidden />
            </a>
          ) : (
            <span className="text-zinc-300 dark:text-zinc-700" aria-hidden>—</span>
          ),
      },
    ],
    [],
  );

  return (
    <DataTable
      rows={posts}
      columns={columns}
      getRowKey={(p) => p.id}
      caption="Social posts matching the current filters"
      empty={empty}
      sort={{ id: sort, direction }}
      onSortChange={(next) => {
        if (!SORTABLE.has(next.id)) return;
        onSortChange(next.id as SortKey, next.direction);
      }}
    />
  );
}
