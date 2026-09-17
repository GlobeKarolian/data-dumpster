import * as React from 'react';
import type { V2State } from '@/lib/v2/state';
import { transitionUrl } from '@/lib/v2/state';
export function PostFilters({ state }: { state: V2State }) {
  const sp = new URLSearchParams(transitionUrl('/v2/posts', state).split('?')[1]);
  return <form action="/v2/posts" method="get" className="v2-post-filters" role="search">
    {[...sp].filter(([k]) => !['q','sort','direction','page','post','inspect'].includes(k)).map(([k,v]) => <input key={k} type="hidden" name={k} value={v} />)}
    <label className="v2-search-label">Search posts<input type="search" name="q" defaultValue={state.q} placeholder="Text, URL or domain" maxLength={300} /></label>
    <label>Sort by<select name="sort" defaultValue={state.sort}><option value="engagementTotal">Observed engagement</option><option value="postedAt">Publication date</option><option value="engagementRateByFollower">Follower engagement rate</option><option value="applause">Applause</option><option value="conversation">Comments / replies</option><option value="amplification">Shares / reposts</option><option value="views">Views</option></select></label>
    <label>Order<select name="direction" defaultValue={state.direction}><option value="desc">Highest / newest first</option><option value="asc">Lowest / oldest first</option></select></label><button className="v2-button" type="submit">Find posts</button>
  </form>;
}
