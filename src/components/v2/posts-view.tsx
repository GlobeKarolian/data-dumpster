import * as React from 'react';
import Link from 'next/link';
import type { V2Data } from '@/lib/v2/reader';
import { transitionUrl } from '@/lib/v2/state';
import { metricText } from '@/lib/v2/presentation';
import { PostRow } from './post-row';
import { PostFilters } from './post-filters';
import { Inspector } from './inspector';
export function PostsView({ data }: { data: V2Data }) {
  const { ctx, state, posts } = data;
  const total = posts?.total ?? 0, pageSize = posts?.pageSize ?? 25;
  const pages = Math.max(1, Math.ceil(total / pageSize));
  return <>
    <header className="v2-page-heading"><div><p className="v2-eyebrow">Explore / {ctx.landscape?.name}</p><h1>Posts<span className="v2-heading-dot">.</span></h1><p>The captured record. Find a post, then look closer.</p></div><div className="v2-result-total"><strong>{metricText('posts',total)}</strong><span>matching captured posts</span></div></header>
    <PostFilters key={JSON.stringify(state)} state={state} />
    <p className="v2-note">Results cover stored posts, not a guaranteed complete feed. Engagements are cumulative stored counters; blanks withhold unverified zeros.</p>
    <div className="v2-explorer-columns"><section aria-label="Post results"><div className="v2-section-heading"><h2>Results</h2><span>{total ? `${(state.page-1)*pageSize+1}–${Math.min(state.page*pageSize,total)} of ${metricText('posts',total)}` : 'No matches'}</span></div>
      {posts?.items.length ? <div className="v2-results-list">{posts.items.map(post => <PostRow key={post.id} post={post} sort={state.sort} landscape={state.landscape} selected={post.id === state.post} href={transitionUrl('/v2/posts',state,{post:post.id})} />)}</div> : <div className="v2-empty"><h2>No captured posts match</h2><p>Try another date window, platform or company, or clear your search. Missing observations are not evidence of no publishing.</p><Link className="v2-button" href={transitionUrl('/v2/posts',state,{ q:'', companies:'', platforms:'' })}>Clear post filters</Link></div>}
      <nav className="v2-pagination" aria-label="Post results pagination">{state.page > 1 ? <Link className="v2-button" href={transitionUrl('/v2/posts',state,{page:state.page-1,post:'',inspect:'post'})}>← Previous page</Link> : <span className="v2-button" aria-disabled="true">← Previous page</span>}<span>Page {state.page} of {pages}</span>{state.page < pages ? <Link className="v2-button" href={transitionUrl('/v2/posts',state,{page:state.page+1,post:'',inspect:'post'})}>Next page →</Link> : <span className="v2-button" aria-disabled="true">Next page →</span>}</nav>
    </section><Inspector data={data} /></div>
  </>;
}
