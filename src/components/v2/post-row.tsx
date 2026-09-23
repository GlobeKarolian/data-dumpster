import * as React from 'react';
import Link from 'next/link';
import type { PostDto, SortKey } from '@/lib/metrics/contract';
import { PLATFORM_LABELS } from '@/lib/types';
import { metricText, observedCounter, timestamp } from '@/lib/v2/presentation';
import { PostMedia } from './media';
export function PostRow({ post, href, selected = false, index, landscape, sort = 'engagementTotal' }: { post: PostDto; href: string; selected?: boolean; index?: number; landscape?: string; sort?: SortKey }) {
  const key = sort === 'postedAt' ? 'engagementTotal' : sort;
  const value = key === 'engagementRateByFollower' ? metricText(key, post[key], !!post.followersAtPost && post.followersAtPost > 0 && post.engagementTotal > 0) : observedCounter(post[key]);
  const label = { engagementTotal: 'observed engagements', engagementRateByFollower: 'follower eng. rate', applause: 'observed applause', conversation: 'observed replies', amplification: 'observed shares', views: 'observed views' }[key];
  return <article className={'v2-post-row' + (selected ? ' is-selected' : '')}>
    {index !== undefined && <span className="v2-post-rank" aria-hidden="true">{String(index + 1).padStart(2, '0')}</span>}
    <PostMedia key={post.id} url={post.thumbnailUrl} company={post.company.name} postId={post.id} landscape={landscape} archived={post.hasArchivedThumbnail} />
    <div className="v2-post-copy"><div className="v2-post-meta"><strong>{post.company.name}</strong><span>{PLATFORM_LABELS[post.platform]} · {post.type}</span></div>
      <Link className="v2-post-title" href={href} scroll={false} aria-current={selected ? 'true' : undefined}>{post.text || 'Post without captured text'}</Link>
      <div className="v2-post-bottom"><time dateTime={post.postedAt}>{timestamp(post.postedAt)}</time><Link className="v2-inline-link" href={href} scroll={false}>Inspect post →</Link></div>
    </div><div className="v2-post-value"><strong>{value}</strong><span>{label}</span></div>
  </article>;
}
