'use client';

import * as React from 'react';
import { ExternalLink, Link2 } from 'lucide-react';
import type { UrlRow } from '@/lib/metrics/contract';
import { cn } from '@/lib/utils';
import { DataTable, type Column } from '@/components/ui/table';
import { MetricLabel } from '@/components/ui/metric-label';
import { EmptyState } from '@/components/ui/empty-state';
import { Tooltip } from '@/components/ui/tooltip';
import { formatMetric, truncate } from '@/components/ui/format';

/**
 * Who is driving traffic where. The company column is the interesting one: a
 * domain that three competitors all link to is a story everyone is chasing, and
 * a domain only one of them links to is either a scoop or a syndication deal.
 */
export function UrlTable({ rows, groupBy }: { rows: UrlRow[]; groupBy: 'domain' | 'url' }) {
  const columns: Column<UrlRow>[] = React.useMemo(
    () => [
      {
        id: 'key',
        header: groupBy === 'domain' ? 'Domain' : 'URL',
        sortValue: (r) => r.key,
        cell: (r) => (
          <div className="min-w-0 max-w-md">
            <span className="block truncate font-medium text-zinc-900 dark:text-zinc-100">
              {groupBy === 'domain' ? r.domain : truncate(r.title ?? r.key, 90)}
            </span>
            {groupBy === 'url' ? (
              <span className="block truncate text-[11px] text-zinc-500">{r.domain}</span>
            ) : null}
          </div>
        ),
      },
      {
        id: 'companies',
        header: 'Linked by',
        hideBelow: 'md',
        cell: (r) => (
          <div className="flex flex-wrap items-center gap-1">
            {r.companies.slice(0, 4).map((c) => (
              <Tooltip
                key={c.company.id}
                side="top"
                content={c.company.name + ' · ' + c.postCount + (c.postCount === 1 ? ' post' : ' posts')}
              >
                <span
                  tabIndex={0}
                  className="inline-flex items-center rounded bg-zinc-100 px-1.5 py-0.5 text-[10px] text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300"
                >
                  {c.company.name}
                </span>
              </Tooltip>
            ))}
            {r.companies.length > 4 ? (
              <span className="pb-num text-[10px] text-zinc-400">
                {'+' + (r.companies.length - 4)}
              </span>
            ) : null}
          </div>
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
        cell: (r) => (
          <span className="font-medium text-zinc-900 dark:text-zinc-100">
            {formatMetric(r.engagementPerPost, 'engagementPerPost')}
          </span>
        ),
      },
      {
        id: 'open',
        header: <span className="sr-only">Open</span>,
        width: 'w-8',
        align: 'center',
        cell: (r) => (
          <a
            href={r.sampleUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex text-zinc-400 transition-colors hover:text-accent-600"
            aria-label={'Open ' + r.domain}
          >
            <ExternalLink className="h-3.5 w-3.5" aria-hidden />
          </a>
        ),
      },
    ],
    [groupBy],
  );

  return (
    <DataTable
      rows={rows}
      columns={columns}
      getRowKey={(r) => r.key}
      caption={groupBy === 'domain' ? 'Domains linked from posts' : 'Individual URLs linked from posts'}
      defaultSort={{ id: 'engagementTotal', direction: 'desc' }}
      maxHeight="34rem"
      empty={
        <EmptyState
          compact
          icon={Link2}
          title="No links in this window"
          description="Pressbox extracts every URL it finds in a post caption. Nothing was linked in this window, or the posts carrying links have not been ingested yet."
        />
      }
    />
  );
}

/** Domain versus URL rollup switch, written to the URL so the view is shareable. */
export function GroupByToggle({
  value,
  onChange,
}: {
  value: 'domain' | 'url';
  onChange: (next: 'domain' | 'url') => void;
}) {
  return (
    <div className="inline-flex items-center gap-0.5 rounded-md border border-zinc-200 bg-zinc-50 p-0.5 dark:border-zinc-800 dark:bg-zinc-900">
      {(['domain', 'url'] as const).map((option) => (
        <button
          key={option}
          type="button"
          onClick={() => onChange(option)}
          aria-pressed={value === option}
          className={cn(
            'inline-flex h-7 items-center rounded px-2 text-xs font-medium capitalize transition-colors',
            value === option
              ? 'bg-white text-zinc-900 shadow-sm dark:bg-zinc-800 dark:text-zinc-100'
              : 'text-zinc-500 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100',
          )}
        >
          {option === 'domain' ? 'By domain' : 'By URL'}
        </button>
      ))}
    </div>
  );
}
