import * as React from 'react';
import Link from 'next/link';
import type { V2Data } from '@/lib/v2/reader';
import { transitionUrl } from '@/lib/v2/state';
import { metricText } from '@/lib/v2/presentation';
import { PostRow } from './post-row';
import { Health } from './health';
export function TodayView({ data }: { data: V2Data }) {
  const { ctx, state, posts, rows, coverage, range } = data;
  const inspectState = { ...state, range: '24h' as const, at: range.end.toISOString(), start: '', end: '', q: '', page: 1 };
  return <>
    <header className="v2-page-heading"><div><p className="v2-eyebrow">Monitor / {ctx.landscape?.name}</p><h1>Today<span className="v2-heading-dot">.</span></h1><p>Last 24 hours <span className="v2-muted">· Posts published in this window, ordered by observed engagement.</span></p></div><Link className="v2-button" href={transitionUrl('/v2/compare', state)}>Compare coverage →</Link></header>
    <div className="v2-monitor-columns"><section aria-labelledby="observed-posts"><div className="v2-section-heading"><h2 id="observed-posts">The observed feed</h2><span>{metricText('posts', posts?.total ?? 0)} captured posts</span></div>
      <p className="v2-note">Engagement is the latest stored cumulative count, not engagement earned only during these 24 hours. Different platforms expose different counters.</p>
      {posts?.items.length ? <div className="v2-editorial-list">{posts.items.map((post,i) => <PostRow key={post.id} index={i} post={post} landscape={state.landscape} href={transitionUrl('/v2/posts', { ...inspectState, post: post.id })} />)}</div> : <div className="v2-empty"><h3>No captured posts in the last 24 hours</h3><p>This is not proof that these companies were silent. Check source coverage or widen the publication window in Posts.</p></div>}
      <Link className="v2-end-link" href={transitionUrl('/v2/posts', inspectState)}>Explore all posts in these 24 hours →</Link>
    </section><aside className="v2-monitor-rail"><Health coverage={coverage} landscape={state.landscape} /><section><div className="v2-section-heading"><h2>Brand activity</h2><span>24h</span></div><p className="v2-note">Observed posts, not complete publishing totals.</p><ol className="v2-activity">{rows.map(row => <li key={row.company.id}><Link href={transitionUrl('/v2/posts', inspectState, { companies: row.company.id })}>{row.company.name}</Link><strong>{metricText('posts', row.value, row.available)}</strong></li>)}</ol>{!rows.length && <p className="v2-muted">No brand observations available.</p>}</section></aside></div>
  </>;
}
