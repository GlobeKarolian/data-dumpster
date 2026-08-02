'use client';

import * as React from 'react';
import { ExternalLink, ImageOff, Play } from 'lucide-react';
import type { PostDto, SortKey } from '@/lib/metrics/contract';
import { postPosterUrl } from '@/lib/post-preview-url';
import { platformMetricLabel } from '@/lib/platform-language';
import { PLATFORM_LABELS, type Platform } from '@/lib/types';
import { Badge, PlatformBadge } from '@/components/ui/badge';
import { DataTable, type Column, type SortDirection } from '@/components/ui/table';
import { MetricLabel } from '@/components/ui/metric-label';
import { formatDateTime, formatMetric, truncate } from '@/components/ui/format';
import { OUTLIER_THRESHOLD, OutlierBadge } from './post-card';
import { isPostMetricReported, type PostComponentMetric } from './post-metric-availability';
import {
  DEFAULT_POST_COLUMNS,
  type PostColumnId,
} from './post-columns';

export {
  DEFAULT_POST_COLUMNS,
  defaultPostColumnsForPlatforms,
  isPostColumnId,
  POST_COLUMN_OPTIONS,
  REDDIT_POST_COLUMNS,
  type PostColumnId,
} from './post-columns';

export interface PostsTableProps {
  posts: PostDto[];
  sort: SortKey;
  direction: SortDirection;
  visibleColumns?: readonly PostColumnId[];
  platform?: Platform;
  onSortChange: (sort: SortKey, direction: SortDirection) => void;
  onPostSelect?: (post: PostDto) => void;
  empty?: React.ReactNode;
}

const SORTABLE = new Set<string>([
  'postedAt', 'engagementTotal', 'engagementRateByFollower',
  'applause', 'conversation', 'amplification', 'views',
]);

function CompactPostedAt({ value }: { value: string }) {
  const formatted = formatDateTime(value);
  const separator = formatted.indexOf(',');
  const date = separator === -1 ? formatted : formatted.slice(0, separator);
  const time = separator === -1 ? null : formatted.slice(separator + 1).trim();

  return (
    <span className="pb-num block whitespace-nowrap leading-tight text-zinc-500">
      <span className="block font-medium text-zinc-700 dark:text-zinc-300">{date}</span>
      {time ? <span className="mt-1 block text-[11px] text-zinc-400">{time}</span> : null}
    </span>
  );
}

function CompactPostPreview({ post }: { post: PostDto }) {
  const [failed, setFailed] = React.useState(false);
  const src = postPosterUrl(post);
  const isMotion = ['video', 'reel', 'short', 'live'].includes(post.type);
  if (!src) return null;

  return (
    <div className="relative flex h-14 w-14 shrink-0 items-center justify-center overflow-hidden rounded border border-zinc-200 bg-zinc-100 text-zinc-400 dark:border-zinc-800 dark:bg-zinc-800 dark:text-zinc-500">
      {failed ? (
        isMotion
          ? <Play className="h-5 w-5 fill-current" aria-hidden />
          : <ImageOff className="h-4 w-4" aria-hidden />
      ) : (
        // Social previews intentionally bypass Next image optimization.
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={src}
          alt=""
          loading="lazy"
          className="h-full w-full object-cover"
          onError={() => setFailed(true)}
        />
      )}
      {!failed && isMotion ? (
        <span className="pointer-events-none absolute inset-0 flex items-center justify-center bg-black/15">
          <span className="flex h-6 w-6 items-center justify-center rounded-full bg-black/60 text-white shadow-sm">
            <Play className="ml-px h-3 w-3 fill-current" aria-hidden />
          </span>
        </span>
      ) : null}
    </div>
  );
}

function postComponentValue(post: PostDto, metric: PostComponentMetric): string {
  const value = post[metric];
  return isPostMetricReported(post.platform, post.type, metric, value)
    ? formatMetric(value, metric)
    : '—';
}

/**
 * Server-sorted table. Sorting has to happen in Postgres because the explorer
 * pages through tens of thousands of posts; sorting the visible 25 would answer
 * a different and much less useful question.
 */
export function PostsTable({
  posts,
  sort,
  direction,
  visibleColumns = DEFAULT_POST_COLUMNS,
  platform,
  onSortChange,
  onPostSelect,
  empty,
}: PostsTableProps) {
  const allColumns: Column<PostDto>[] = React.useMemo(
    () => [
      {
        id: 'postedAt',
        sortable: true,
        header: 'Posted',
        width: 'w-24',
        cellClassName: 'align-top',
        cell: (p) => <CompactPostedAt value={p.postedAt} />,
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
        cell: (p) => <PlatformBadge platform={p.platform} />,
      },
      {
        id: 'text',
        header: 'Post',
        headerClassName: 'min-w-80',
        cellClassName: 'min-w-80 align-top',
        cell: (p) => (
          <div className="flex min-w-0 max-w-2xl items-start gap-3">
            <CompactPostPreview post={p} />

            <div className="min-w-0 flex-1">
              <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
                <span className="truncate font-semibold text-zinc-900 dark:text-zinc-100">
                  {p.company.name}
                </span>
                <PlatformBadge platform={p.platform} />
                {p.permalink ? (
                  <a
                    href={p.permalink}
                    target="_blank"
                    rel="noopener noreferrer"
                    onClick={(event) => event.stopPropagation()}
                    className="inline-flex items-center gap-1 text-[11px] text-zinc-400 transition-colors hover:text-accent-600"
                    aria-label={'Open the original ' + PLATFORM_LABELS[p.platform] + ' post'}
                  >
                    <ExternalLink className="h-3 w-3" aria-hidden />
                    Original
                  </a>
                ) : null}
              </div>

              <p className="mt-1 text-xs leading-relaxed text-zinc-600 dark:text-zinc-400">
                {p.text ? truncate(p.text, 180) : <span className="italic text-zinc-400">No caption</span>}
              </p>

              {p.tags.length > 0 || (p.outlierScore !== null && p.outlierScore > OUTLIER_THRESHOLD) ? (
                <div className="mt-1.5 flex flex-wrap items-center gap-1">
                  {p.outlierScore !== null && p.outlierScore > OUTLIER_THRESHOLD ? (
                    <span onClick={(event) => event.stopPropagation()}>
                      <OutlierBadge score={p.outlierScore} />
                    </span>
                  ) : null}
                  {p.tags.slice(0, 3).map((t) => (
                    <Badge key={t.id} tone="outline">{t.name}</Badge>
                  ))}
                </div>
              ) : null}
            </div>
          </div>
        ),
      },
      {
        id: 'type',
        header: 'Type',
        width: 'w-20',
        cell: (p) => <span className="capitalize text-zinc-500">{p.type}</span>,
      },
      {
        id: 'followersAtPost',
        header: 'Followers at post',
        align: 'right',
        cell: (p) => formatMetric(p.followersAtPost, 'audience'),
      },
      {
        id: 'applause',
        sortable: true,
        header: <MetricLabel metric="applause" text={platform ? platformMetricLabel('applause', platform) : undefined} short align="end" />,
        align: 'right',
        cell: (p) => postComponentValue(p, 'applause'),
      },
      {
        id: 'conversation',
        sortable: true,
        header: <MetricLabel metric="conversation" text={platform ? platformMetricLabel('conversation', platform) : undefined} short align="end" />,
        align: 'right',
        cell: (p) => postComponentValue(p, 'conversation'),
      },
      {
        id: 'amplification',
        sortable: true,
        header: <MetricLabel metric="amplification" text={platform ? platformMetricLabel('amplification', platform) : undefined} short align="end" />,
        align: 'right',
        cell: (p) => postComponentValue(p, 'amplification'),
      },
      {
        id: 'saves',
        header: <MetricLabel metric="saves" short align="end" />,
        align: 'right',
        cell: (p) => postComponentValue(p, 'saves'),
      },
      {
        id: 'views',
        sortable: true,
        header: <MetricLabel metric="views" short align="end" />,
        align: 'right',
        cell: (p) => postComponentValue(p, 'views'),
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
        header: <MetricLabel metric="engagementRateByFollower" text={platform ? platformMetricLabel('engagementRateByFollower', platform) : undefined} short align="end" />,
        align: 'right',
        cell: (p) => p.followersAtPost !== null && p.followersAtPost > 0
          ? formatMetric(p.engagementRateByFollower, 'engagementRateByFollower')
          : '—',
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
              onClick={(event) => event.stopPropagation()}
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
    [platform],
  );
  const columns = React.useMemo(
    () =>
      visibleColumns
        .map((columnId) => allColumns.find((column) => column.id === columnId))
        .filter((column): column is Column<PostDto> => column !== undefined),
    [allColumns, visibleColumns],
  );

  return (
    <DataTable
      rows={posts}
      columns={columns}
      getRowKey={(p) => p.id}
      caption="Social posts matching the current filters"
      empty={empty}
      sort={{ id: sort, direction }}
      onRowClick={onPostSelect}
      rowAriaLabel={
        onPostSelect
          ? (post) => 'View post details for ' + post.company.name + ' on ' + PLATFORM_LABELS[post.platform]
          : undefined
      }
      onSortChange={(next) => {
        if (!SORTABLE.has(next.id)) return;
        onSortChange(next.id as SortKey, next.direction);
      }}
    />
  );
}
