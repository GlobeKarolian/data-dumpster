'use client';

import * as React from 'react';
import Link from 'next/link';
import { FileText } from 'lucide-react';
import type { PostDto } from '@/lib/metrics/contract';
import { PLATFORM_LABELS, type Platform } from '@/lib/types';
import { publicationNoun } from '@/lib/platform-language';
import { hrefWithGlobalParams, useUrlState } from '@/components/common/use-url-state';
import { Panel } from '@/components/common/panel';
import { EmptyState } from '@/components/ui/empty-state';
import { PostCard } from '@/components/posts/post-card';

/**
 * Best post per platform for the focus company. Rival IQ shows a wall of top
 * posts; one per channel is more useful, because the interesting comparison is
 * across channels rather than down a single feed.
 */
export function TopPostsPanel({
  posts,
  error,
  title = 'Top post by channel',
  href = '/posts',
  platform,
  landscapeId,
}: {
  posts: PostDto[];
  error?: string | null;
  title?: string;
  href?: string;
  platform?: Platform;
  landscapeId?: string | null;
}) {
  const { searchParams } = useUrlState();
  const plural = platform ? publicationNoun(platform).toLowerCase() : 'posts';
  const singular = platform ? publicationNoun(platform, false).toLowerCase() : 'post';
  const scopedHref = hrefWithGlobalParams(
    href,
    searchParams,
    {
      ...(landscapeId ? { landscape: landscapeId } : {}),
      ...(platform ? { platforms: [platform] } : {}),
    },
  );

  return (
    <Panel
      title={title}
      description={'The single highest-engagement ' + singular + ' on each channel inside this window.'}
      error={error}
      toolbar={
        <Link
          href={scopedHref}
          className="text-xs font-medium text-accent-600 hover:underline dark:text-accent-500"
        >
          {'All ' + plural}
        </Link>
      }
      bodyClassName="p-3"
    >
      {posts.length === 0 ? (
        <EmptyState
          compact
          icon={FileText}
          title={'No ' + plural + ' in this window'}
          description="Nothing was published, or nothing has been ingested yet. Check the channel list and the last ingest time under Sources."
          action={{ label: 'Review sources', href: '/settings/sources' }}
        />
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {posts.map((p) => (
            <div key={p.id}>
              <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-wider text-zinc-400">
                {PLATFORM_LABELS[p.platform]}
              </p>
              <PostCard post={p} />
            </div>
          ))}
        </div>
      )}
    </Panel>
  );
}
