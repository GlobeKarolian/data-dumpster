'use client';

import * as React from 'react';
import type { UrlRow } from '@/lib/metrics/contract';
import { Panel } from '@/components/common/panel';
import { useUrlState } from '@/components/common/use-url-state';
import { GroupByToggle, UrlTable } from './url-table';

export function UrlView({
  rows,
  groupBy,
  error,
}: {
  rows: UrlRow[];
  groupBy: 'domain' | 'url';
  error?: string | null;
}) {
  const { setParams } = useUrlState();
  return (
    <Panel
      title={groupBy === 'domain' ? 'Domains by engagement' : 'URLs by engagement'}
      description={
        groupBy === 'domain'
          ? 'Every host linked from a post in this window, ranked by the engagement those posts earned.'
          : 'Individual links, deduplicated by canonical URL where the platform gave us one.'
      }
      error={error}
      bodyClassName="p-0"
      toolbar={<GroupByToggle value={groupBy} onChange={(next) => setParams({ groupBy: next })} />}
      note="A post contributes to a domain once, no matter how many times it links there, so engagement is never double counted."
    >
      <UrlTable rows={rows} groupBy={groupBy} />
    </Panel>
  );
}
