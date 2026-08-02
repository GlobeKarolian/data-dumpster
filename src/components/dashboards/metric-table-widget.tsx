'use client';

import * as React from 'react';
import type { MetricKey, MetricRow, Platform } from '@/lib/types';
import { PLATFORM_LABELS } from '@/lib/types';
import { DataTable, RankCell, type Column } from '@/components/ui/table';
import { DeltaBadge } from '@/components/ui/delta-badge';
import { formatMetric } from '@/components/ui/format';
import { MetricLabel } from '@/components/ui/metric-label';

export function MetricTableWidget({
  rows,
  metric,
  focusCompanyId,
  label,
}: {
  rows: MetricRow[];
  metric: MetricKey;
  focusCompanyId: string | null;
  label?: string;
}) {
  const platforms = React.useMemo(() => {
    const seen = new Set<Platform>();
    for (const row of rows) {
      for (const platform of Object.keys(row.breakdown ?? {}) as Platform[]) {
        seen.add(platform);
      }
    }
    return [...seen].sort((a, b) => PLATFORM_LABELS[a].localeCompare(PLATFORM_LABELS[b]));
  }, [rows]);

  const columns = React.useMemo<Column<MetricRow>[]>(
    () => [
      {
        id: 'rank',
        header: 'Rank',
        cell: (row) => (
          row.available
            ? <RankCell rank={row.rank} highlight={row.company.id === focusCompanyId} />
            : <span className="text-zinc-400">—</span>
        ),
        sortValue: (row) => row.available ? row.rank : null,
        width: 'w-14',
      },
      {
        id: 'company',
        header: 'Company',
        cell: (row) => (
          <span className={row.company.id === focusCompanyId ? 'font-semibold text-zinc-950 dark:text-zinc-50' : undefined}>
            {row.company.name}
          </span>
        ),
        sortValue: (row) => row.company.name,
      },
      {
        id: 'value',
        header: <MetricLabel metric={metric} text={label} short align="end" />,
        cell: (row) => formatMetric(row.available ? row.value : null, metric, 'full'),
        sortValue: (row) => row.available ? row.value : null,
        align: 'right',
      },
      {
        id: 'previous',
        header: 'Previous',
        cell: (row) => formatMetric(row.previousAvailable ? row.previousValue : null, metric, 'full'),
        sortValue: (row) => row.previousAvailable ? row.previousValue ?? null : null,
        align: 'right',
        hideBelow: 'md',
      },
      {
        id: 'change',
        header: 'Change',
        cell: (row) => (
          <DeltaBadge
            changePct={row.changePct}
            previousLabel={formatMetric(row.previousValue, metric, 'full')}
          />
        ),
        sortValue: (row) => row.changePct ?? null,
        align: 'right',
      },
      ...platforms.map(
        (platform): Column<MetricRow> => ({
          id: 'platform-' + platform,
          header: PLATFORM_LABELS[platform],
          cell: (row) => formatMetric(
            row.breakdownAvailability?.[platform] === false ? null : row.breakdown?.[platform],
            metric,
            'full',
          ),
          sortValue: (row) =>
            row.breakdownAvailability?.[platform] === false
              ? null
              : row.breakdown?.[platform] ?? null,
          align: 'right',
          hideBelow: 'xl',
        }),
      ),
    ],
    [focusCompanyId, label, metric, platforms],
  );

  return (
    <DataTable
      rows={rows}
      columns={columns}
      getRowKey={(row) => row.company.id}
      defaultSort={{ id: 'value', direction: 'desc' }}
      maxHeight="34rem"
      caption="Company metric comparison with previous-window change and per-channel breakdown"
      empty={
        <p className="py-10 text-center text-xs text-zinc-500">
          No company metrics are available for this window.
        </p>
      }
    />
  );
}
