'use client';

import * as React from 'react';
import Link from 'next/link';
import { ExternalLink, FileText } from 'lucide-react';
import type { PostDetailDto, PostDto } from '@/lib/metrics/contract';
import { postPosterUrl } from '@/lib/post-preview-url';
import { PLATFORM_COLORS, PLATFORM_LABELS } from '@/lib/types';
import { cn } from '@/lib/utils';
import { apiUrl } from '@/components/common/api-params';
import { hrefWithGlobalParams, useUrlState } from '@/components/common/use-url-state';
import { Panel } from '@/components/common/panel';
import { PostDetailDialog } from '@/components/posts/post-detail-dialog';
import { PlatformBadge } from '@/components/ui/badge';
import { EmptyState } from '@/components/ui/empty-state';
import { formatMetric, truncate } from '@/components/ui/format';

export interface TopPostsByChannelProps {
  /** Best focus-company post for each platform in the current analytics window. */
  posts: PostDto[];
  error?: string | null;
  title?: string;
  allPostsHref?: string;
  /** Enables the built-in post detail modal through the existing detail endpoint. */
  landscapeId?: string | null;
  /** Client-only integration hook. The built-in modal still opens when landscapeId is present. */
  onPostSelect?: (post: PostDto) => void;
}

function comparisonNarrative(post: PostDto): string {
  const platform = PLATFORM_LABELS[post.platform];
  const score = post.outlierScore;

  if (
    score !== null
    && Number.isFinite(score)
    && post.medianEngagement !== null
    && post.medianEngagement > 0
  ) {
    if (score >= 3) {
      return (
        'Breakout performance: ' + score.toFixed(1) + 'x ' + post.company.name
        + '’s median ' + platform + ' post engagement in this window.'
      );
    }
    if (score >= 1) {
      return (
        'Above the account baseline at ' + score.toFixed(1) + 'x '
        + post.company.name + '’s median ' + platform + ' post engagement.'
      );
    }
    return (
      'This post reached ' + score.toFixed(1) + 'x ' + post.company.name
      + '’s median ' + platform + ' post engagement in this window.'
    );
  }

  return (
    'This is ' + post.company.name + '’s highest-engagement ' + platform
    + ' post in the selected window. A reliable median comparison is not available.'
  );
}

function PostMedia({
  post,
  onSelect,
}: {
  post: PostDto;
  onSelect?: () => void;
}) {
  const [failed, setFailed] = React.useState(false);
  const previewUrl = postPosterUrl(post);
  const hasPreview = Boolean(previewUrl) && !failed;
  const content = (
    <>
      {hasPreview ? (
        // Social images come from multiple remote CDNs and intentionally bypass optimization.
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={previewUrl ?? undefined}
          alt=""
          loading="lazy"
          className="absolute inset-0 h-full w-full object-cover transition-transform duration-200 group-hover:scale-[1.015]"
          onError={() => setFailed(true)}
        />
      ) : (
        <span className="absolute inset-0 flex flex-col items-center justify-center gap-3 px-8 text-center">
          <FileText className="h-6 w-6 text-zinc-300 dark:text-zinc-700" aria-hidden />
          <span className="text-sm leading-relaxed text-zinc-600 dark:text-zinc-400">
            {post.text ? truncate(post.text, 150) : 'No media or caption was captured for this post.'}
          </span>
        </span>
      )}
      <span
        aria-hidden
        className={cn(
          'absolute inset-x-0 bottom-0 h-2/3 bg-gradient-to-t from-black/85 via-black/30 to-transparent',
          !hasPreview && 'hidden',
        )}
      />
      <span className="absolute inset-x-0 bottom-0 flex items-end justify-between gap-3 p-4 text-white">
        <span className="min-w-0">
          <span className="block truncate text-sm font-semibold">{post.company.name}</span>
          <span className="pb-num mt-0.5 block text-xs font-medium text-white/90">
            {formatMetric(post.engagementTotal, 'engagementTotal') + ' total engagement'}
          </span>
        </span>
        <span
          className="h-3 w-3 shrink-0 rounded-sm ring-2 ring-white/80"
          style={{ backgroundColor: PLATFORM_COLORS[post.platform] }}
          aria-hidden="true"
        />
      </span>
    </>
  );

  return onSelect ? (
    <button
      type="button"
      onClick={onSelect}
      className={cn(
        'group relative block min-h-64 w-full overflow-hidden bg-zinc-100 text-left',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent-500',
        'dark:bg-zinc-950',
      )}
      aria-label={
        'View details for ' + post.company.name + '’s top ' + PLATFORM_LABELS[post.platform] + ' post'
      }
    >
      {content}
    </button>
  ) : (
    <div className="group relative min-h-64 overflow-hidden bg-zinc-100 dark:bg-zinc-950">
      {content}
    </div>
  );
}

export function TopPostsByChannel({
  posts,
  error,
  title = 'Top Posts by Channel',
  allPostsHref = '/posts',
  landscapeId,
  onPostSelect,
}: TopPostsByChannelProps) {
  const { searchParams } = useUrlState();
  const [selectedPost, setSelectedPost] = React.useState<PostDto | null>(null);
  const [detailAttempt, setDetailAttempt] = React.useState(0);
  const screenParams = React.useMemo(
    () => new URLSearchParams(searchParams.toString()),
    [searchParams],
  );
  const detailRequestUrl = React.useMemo(
    () =>
      selectedPost && landscapeId
        ? apiUrl(
            '/api/posts/' + encodeURIComponent(selectedPost.id),
            screenParams,
            landscapeId,
            { detailAttempt: detailAttempt || undefined },
          )
        : '',
    [detailAttempt, landscapeId, screenParams, selectedPost],
  );
  const [loadedDetail, setLoadedDetail] = React.useState<{
    url: string;
    data: PostDetailDto | null;
    error: string | null;
  }>({ url: '', data: null, error: null });
  const detailLoading = detailRequestUrl !== '' && loadedDetail.url !== detailRequestUrl;
  const detail = loadedDetail.url === detailRequestUrl ? loadedDetail.data : null;
  const detailError = loadedDetail.url === detailRequestUrl ? loadedDetail.error : null;
  const scopedHref = hrefWithGlobalParams(
    allPostsHref,
    screenParams,
    landscapeId ? { landscape: landscapeId } : undefined,
  );

  React.useEffect(() => {
    if (!detailRequestUrl) return;
    let cancelled = false;
    const controller = new AbortController();

    fetch(detailRequestUrl, { signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) {
          throw new Error('The post detail service returned ' + response.status + '.');
        }
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

  const selectPost = (post: PostDto) => {
    onPostSelect?.(post);
    if (landscapeId) setSelectedPost(post);
  };
  const canSelect = Boolean(landscapeId || onPostSelect);

  return (
    <>
      <Panel
        title={title}
        error={error}
        toolbar={
          <Link
            href={scopedHref}
            className="text-xs font-medium text-accent-600 hover:underline dark:text-accent-500"
          >
            All posts
          </Link>
        }
        bodyClassName="p-0"
      >
        {posts.length === 0 ? (
          <div className="p-4">
            <EmptyState
              compact
              icon={FileText}
              title="No top posts in this window"
              description="Nothing was published, or the focus company’s posts have not been ingested yet."
              action={{ label: 'Review sources', href: '/settings/sources' }}
            />
          </div>
        ) : (
          <div className="grid gap-px bg-zinc-200 xl:grid-cols-2 dark:bg-zinc-800">
            {posts.map((post) => {
              const handleSelect = canSelect ? () => selectPost(post) : undefined;

              return (
                <article
                  key={post.id}
                  className="grid min-w-0 bg-white sm:grid-cols-[minmax(12rem,0.9fr)_minmax(0,1.1fr)] dark:bg-zinc-900"
                >
                  <PostMedia post={post} onSelect={handleSelect} />

                  <div
                    className="flex min-w-0 flex-col justify-center border-l-4 p-5"
                    style={{ borderLeftColor: PLATFORM_COLORS[post.platform] }}
                  >
                    <div className="flex items-center gap-2">
                      <PlatformBadge platform={post.platform} />
                      <h3 className="text-[11px] font-semibold uppercase tracking-wider text-zinc-500 dark:text-zinc-400">
                        {'Top ' + PLATFORM_LABELS[post.platform] + ' post'}
                      </h3>
                    </div>
                    <p className="mt-4 text-sm leading-6 text-zinc-700 dark:text-zinc-300">
                      {comparisonNarrative(post)}
                    </p>
                    <p className="mt-3 text-xs leading-relaxed text-zinc-500 dark:text-zinc-400">
                      {post.text
                        ? truncate(post.text, 120)
                        : 'No caption was captured for this post.'}
                    </p>

                    <div className="mt-5 flex flex-wrap items-center gap-3">
                      {handleSelect ? (
                        <button
                          type="button"
                          onClick={handleSelect}
                          className="text-xs font-medium text-accent-600 hover:underline dark:text-accent-500"
                        >
                          View post details
                        </button>
                      ) : null}
                      {post.permalink ? (
                        <a
                          href={post.permalink}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-1 text-xs font-medium text-zinc-500 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100"
                        >
                          <ExternalLink className="h-3 w-3" aria-hidden />
                          Open original
                        </a>
                      ) : null}
                    </div>
                  </div>
                </article>
              );
            })}
          </div>
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
    </>
  );
}
