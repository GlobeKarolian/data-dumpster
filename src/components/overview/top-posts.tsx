'use client';

import * as React from 'react';
import Link from 'next/link';
import { ArrowRight, ChevronDown, FileText } from 'lucide-react';
import type { PostDetailDto, PostDto } from '@/lib/metrics/contract';
import { PLATFORM_LABELS, type Platform } from '@/lib/types';
import { publicationNoun } from '@/lib/platform-language';
import { apiUrl } from '@/components/common/api-params';
import { hrefWithGlobalParams, useUrlState } from '@/components/common/use-url-state';
import { Panel } from '@/components/common/panel';
import { EmptyState } from '@/components/ui/empty-state';
import { Button } from '@/components/ui/button';
import { PlatformIcon } from '@/components/ui/platform-icon';
import { PostCard } from '@/components/posts/post-card';
import { PostDetailDialog } from '@/components/posts/post-detail-dialog';
import { cn } from '@/lib/utils';

const INITIAL_VISIBLE_POSTS = 6;
const VISIBLE_INCREMENT = 6;

/**
 * Ranked, progressively disclosed post gallery used by both overview surfaces.
 *
 * The server gives this component a platform-balanced set. Six cards answer the
 * casual user's question without turning the page into a feed; channel filters,
 * expansion, full detail and the post-library link keep the same block useful
 * for an analyst who wants to keep digging.
 */
export function TopPostsPanel({
  id,
  posts,
  error,
  title = 'Top posts',
  href = '/posts',
  platform,
  landscapeId,
  scopeLabel,
  perPlatform = 3,
}: {
  id?: string;
  posts: PostDto[];
  error?: string | null;
  title?: string;
  href?: string;
  platform?: Platform;
  landscapeId?: string | null;
  scopeLabel?: string | null;
  perPlatform?: number;
}) {
  const { searchParams } = useUrlState();
  const [selectedPlatform, setSelectedPlatform] = React.useState<'all' | Platform>('all');
  const [visibleCount, setVisibleCount] = React.useState(INITIAL_VISIBLE_POSTS);
  const [selectedPost, setSelectedPost] = React.useState<PostDto | null>(null);
  const [detailAttempt, setDetailAttempt] = React.useState(0);
  const plural = platform ? publicationNoun(platform).toLowerCase() : 'posts';
  const screenParams = React.useMemo(
    () => new URLSearchParams(searchParams.toString()),
    [searchParams],
  );
  const scopedHref = hrefWithGlobalParams(
    href,
    screenParams,
    {
      ...(landscapeId ? { landscape: landscapeId } : {}),
      ...(platform ? { platforms: [platform] } : {}),
    },
  );
  const platforms = React.useMemo(
    () => Array.from(new Set(posts.map((post) => post.platform)))
      .sort((a, b) => PLATFORM_LABELS[a].localeCompare(PLATFORM_LABELS[b])),
    [posts],
  );
  const filteredPosts = selectedPlatform === 'all'
    ? posts
    : posts.filter((post) => post.platform === selectedPlatform);
  const visiblePosts = filteredPosts.slice(0, visibleCount);
  const canExpand = visibleCount < filteredPosts.length;
  const source = scopeLabel ? ' from ' + scopeLabel : '';
  const description = platform
    ? 'Ranked by total engagement' + source + '. Start with the first six, expand the set, or open any '
      + publicationNoun(platform, false).toLowerCase() + ' for its full metric history and links.'
    : 'Up to ' + perPlatform + ' winners per channel' + source
      + ' in the selected window, ranked together by total engagement.';

  const selectPlatform = (value: 'all' | Platform) => {
    setSelectedPlatform(value);
    setVisibleCount(INITIAL_VISIBLE_POSTS);
  };

  const detailRequestUrl = React.useMemo(
    () => selectedPost && landscapeId
      ? apiUrl(
          '/api/posts/' + encodeURIComponent(selectedPost.id),
          screenParams,
          landscapeId,
          {
            detailAttempt: detailAttempt || undefined,
            platforms: platform,
          },
        )
      : '',
    [detailAttempt, landscapeId, platform, screenParams, selectedPost],
  );
  const [loadedDetail, setLoadedDetail] = React.useState<{
    url: string;
    data: PostDetailDto | null;
    error: string | null;
  }>({ url: '', data: null, error: null });
  const detailLoading = detailRequestUrl !== '' && loadedDetail.url !== detailRequestUrl;
  const detail = loadedDetail.url === detailRequestUrl ? loadedDetail.data : null;
  const detailError = loadedDetail.url === detailRequestUrl ? loadedDetail.error : null;

  React.useEffect(() => {
    if (!detailRequestUrl) return;
    let cancelled = false;
    const controller = new AbortController();

    fetch(detailRequestUrl, { signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error('The post detail service returned ' + response.status + '.');
        return (await response.json()) as PostDetailDto;
      })
      .then((data) => {
        if (!cancelled) setLoadedDetail({ url: detailRequestUrl, data, error: null });
      })
      .catch((reason: unknown) => {
        if (cancelled || (reason instanceof DOMException && reason.name === 'AbortError')) return;
        setLoadedDetail({
          url: detailRequestUrl,
          data: null,
          error: reason instanceof Error ? reason.message : 'Could not load the full post record.',
        });
      });

    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [detailRequestUrl]);

  return (
    <section id={id} className="scroll-mt-24">
      <Panel
        title={title}
        description={description}
        error={error}
        toolbar={
          <Link
            href={scopedHref}
            className="inline-flex items-center gap-1 text-xs font-semibold text-accent-600 hover:underline dark:text-accent-500"
          >
            {'Explore all ' + plural}
            <ArrowRight className="h-3 w-3" aria-hidden />
          </Link>
        }
        bodyClassName="p-0"
      >
        {posts.length === 0 ? (
          <div className="p-4">
            <EmptyState
              compact
              icon={FileText}
              title={'No ' + plural + ' in this window'}
              description="Nothing was published, or nothing has been ingested yet. Check Sources for the account's latest collection status."
              action={{ label: 'Review sources', href: '/settings/sources' }}
            />
          </div>
        ) : (
          <>
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-zinc-200 px-3 py-2.5 dark:border-zinc-800">
              <div className="min-w-0 overflow-x-auto">
                {platforms.length > 1 ? (
                  <div className="flex w-max items-center gap-1" role="group" aria-label="Filter top posts by platform">
                    <button
                      type="button"
                      onClick={() => selectPlatform('all')}
                      aria-pressed={selectedPlatform === 'all'}
                      className={cn(
                        'h-8 rounded-md px-2.5 text-xs font-medium transition-colors',
                        selectedPlatform === 'all'
                          ? 'bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-950'
                          : 'text-zinc-500 hover:bg-zinc-100 hover:text-zinc-900 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-zinc-100',
                      )}
                    >
                      All channels
                    </button>
                    {platforms.map((item) => (
                      <button
                        key={item}
                        type="button"
                        onClick={() => selectPlatform(item)}
                        aria-pressed={selectedPlatform === item}
                        className={cn(
                          'inline-flex h-8 items-center gap-1.5 rounded-md px-2.5 text-xs font-medium transition-colors',
                          selectedPlatform === item
                            ? 'bg-zinc-100 text-zinc-900 dark:bg-zinc-800 dark:text-zinc-100'
                            : 'text-zinc-500 hover:bg-zinc-100 hover:text-zinc-900 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-zinc-100',
                        )}
                      >
                        <PlatformIcon platform={item} className="h-3.5 w-3.5" />
                        {PLATFORM_LABELS[item]}
                      </button>
                    ))}
                  </div>
                ) : platforms[0] ? (
                  <div className="inline-flex h-8 items-center gap-1.5 px-1 text-xs font-medium text-zinc-600 dark:text-zinc-300">
                    <PlatformIcon platform={platforms[0]} className="h-3.5 w-3.5" />
                    <span>{PLATFORM_LABELS[platforms[0]]}</span>
                  </div>
                ) : null}
              </div>
              <p className="pb-num shrink-0 text-[11px] text-zinc-500 dark:text-zinc-400">
                {'Showing ' + Math.min(visibleCount, filteredPosts.length) + ' of ' + filteredPosts.length}
              </p>
            </div>

            <div className="grid min-w-0 grid-cols-[repeat(auto-fit,minmax(min(100%,32rem),1fr))] gap-3 p-3">
              {visiblePosts.map((post, index) => (
                <PostCard
                  key={post.id}
                  post={post}
                  rank={index + 1}
                  onSelect={landscapeId ? setSelectedPost : undefined}
                />
              ))}
            </div>

            {filteredPosts.length > INITIAL_VISIBLE_POSTS ? (
              <div className="flex flex-wrap items-center justify-center gap-3 border-t border-zinc-200 px-3 py-3 dark:border-zinc-800">
                <Button
                  type="button"
                  size="sm"
                  onClick={() => setVisibleCount((count) =>
                    canExpand ? Math.min(filteredPosts.length, count + VISIBLE_INCREMENT) : INITIAL_VISIBLE_POSTS)}
                >
                  {canExpand ? 'Show 6 more' : 'Show fewer'}
                  <ChevronDown
                    className={cn('h-3.5 w-3.5 transition-transform', !canExpand && 'rotate-180')}
                    aria-hidden
                  />
                </Button>
                <span className="text-[11px] text-zinc-500 dark:text-zinc-400">
                  Ranked by total engagement in the selected window
                </span>
              </div>
            ) : null}
          </>
        )}
      </Panel>

      {landscapeId ? (
        <PostDetailDialog
          post={selectedPost}
          detail={detail}
          loading={detailLoading}
          error={detailError}
          onClose={() => setSelectedPost(null)}
          onRetry={() => setDetailAttempt((attempt) => attempt + 1)}
        />
      ) : null}
    </section>
  );
}
