import * as React from 'react';
import Link from 'next/link';
import type { IngestionCoverage } from '@/lib/metrics/ingestion-coverage';
import { metricText } from '@/lib/v2/presentation';
export function Health({ coverage, landscape }: { coverage: IngestionCoverage | null; landscape: string }) {
  return <section className="v2-health" id="source-health">
    <h2>Source health</h2><p className="v2-muted">Read-only · selected profiles & window</p>
    {coverage ? <><div className="v2-health-head"><strong>{metricText('posts', coverage.ingestedChannels)} / {metricText('posts', coverage.totalChannels)}</strong><span>profiles certified for the window and their tracked history</span></div>
    <details><summary>Coverage details <span>+</span></summary><dl className="v2-key-values">{([
      ['Certified', coverage.ingestedChannels], ['Source-limited', coverage.limitedChannels], ['Partial history', coverage.partialChannels], ['Collecting', coverage.collectingChannels], ['Failed / retrying', coverage.failedChannels], ['Never attempted', coverage.neverAttemptedChannels],
    ] as const).map(([label,n]) => <div key={label}><dt>{label}</dt><dd>{metricText('posts',n)}</dd></div>)}</dl><p className="v2-note">Certification includes the landscape’s tracked history, which may be wider than this window. A finished collection is not proof of complete coverage.</p></details></> : <p>Coverage unavailable.</p>}
    <p className="v2-note">Source limits can omit posts. These observations do not establish a complete-market ranking.</p>
    <Link className="v2-inline-link" href={'/settings/sources?landscape='+encodeURIComponent(landscape)}>Open data sources ↗</Link>
  </section>;
}
