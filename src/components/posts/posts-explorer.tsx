'use client';

import * as React from 'react';
import {
  ChevronLeft,
  ChevronRight,
  Columns3,
  FileDown,
  FileText,
  Grid3X3,
  LayoutGrid,
  List,
  Search,
} from 'lucide-react';
import { platformMetricLabel } from '@/lib/platform-language';
import {
  PLATFORMS,
  POST_TYPES,
  type MetricKey,
  type Paged,
  type Platform,
} from '@/lib/types';
import type { PostDetailDto, PostDto, SortKey } from '@/lib/metrics/contract';
import { cn } from '@/lib/utils';
import { Card, CardFooter, CardHeader, CardTitle, CardToolbar } from '@/components/ui/card';
import { Button, ButtonGroup, ButtonGroupItem } from '@/components/ui/button';
import { SearchInput } from '@/components/ui/input';
import { MultiSelect } from '@/components/ui/multi-select';
import { Popover, PopoverTriggerSurface } from '@/components/ui/popover';
import { Checkbox } from '@/components/ui/toggle';
import { EmptyState } from '@/components/ui/empty-state';
import { ErrorState } from '@/components/ui/error-state';
import { SkeletonTable } from '@/components/ui/skeleton';
import { useUrlState } from '@/components/common/use-url-state';
import { apiUrl } from '@/components/common/api-params';
import { PostCard } from './post-card';
import { PostDetailDialog } from './post-detail-dialog';
import { PostMosaic } from './post-mosaic';
import {
  defaultPostColumnsForPlatforms,
  isPostColumnId,
  POST_COLUMN_OPTIONS,
  PostsTable,
  type PostColumnId,
} from './posts-table';

export interface PostsExplorerProps {
  landscapeId: string;
  tags: { id: string; name: string; color: string | null }[];
  /** Server-rendered focus-company summary placed in Rival IQ's At a Glance slot. */
  summary?: React.ReactNode;
}

const PAGE_SIZE = 25;
type PostsView = 'table' | 'grid' | 'mosaic';
const PLATFORM_COLUMN_METRICS: Partial<Record<PostColumnId, MetricKey>> = {
  applause: 'applause',
  conversation: 'conversation',
  amplification: 'amplification',
  engagementRateByFollower: 'engagementRateByFollower',
};

function postColumnLabel(
  column: (typeof POST_COLUMN_OPTIONS)[number],
  platform?: Platform,
): string {
  const metric = PLATFORM_COLUMN_METRICS[column.id];
  return platform && metric ? platformMetricLabel(metric, platform) : column.label;
}

function sameColumns(left: readonly PostColumnId[], right: readonly PostColumnId[]) {
  return left.length === right.length && left.every((column, index) => column === right[index]);
}

/**
 * The posts explorer is the screen people live in, so its state lives in the
 * URL and its data comes from the API rather than from a server render: every
 * filter change has to feel like a filter change, not a page load.
 */
export function PostsExplorer({
  landscapeId,
  tags,
  summary,
}: PostsExplorerProps) {
  const { searchParams, getList, setParams } = useUrlState();
  const [selectedPost, setSelectedPost] = React.useState<PostDto | null>(null);
  const [detailAttempt, setDetailAttempt] = React.useState(0);

  const viewParam = searchParams.get('view');
  const view: PostsView = viewParam === 'grid' || viewParam === 'mosaic' ? viewParam : 'table';
  const sort = (searchParams.get('sort') as SortKey | null) ?? 'engagementTotal';
  const direction = searchParams.get('direction') === 'asc' ? 'asc' : 'desc';
  const page = Math.max(1, Number(searchParams.get('page') ?? '1') || 1);
  const urlSearch = searchParams.get('q') ?? '';
  const showPostTags = searchParams.get('showPostTags') !== '0';
  const columnsParam = searchParams.get('columns');
  const selectedPlatforms = getList('platforms');
  const defaultColumns = defaultPostColumnsForPlatforms(selectedPlatforms);
  const tablePlatform: Platform | undefined = selectedPlatforms.length === 1
    && PLATFORMS.some((platform) => platform === selectedPlatforms[0])
    ? selectedPlatforms[0] as Platform
    : undefined;
  const visibleColumns = React.useMemo(() => {
    const requestedSet = new Set((columnsParam?.split(',') ?? []).filter(isPostColumnId));
    const requested = POST_COLUMN_OPTIONS
      .map((column) => column.id)
      .filter((column) => requestedSet.has(column));
    return requested.length > 0 ? requested : [...defaultColumns];
  }, [columnsParam, defaultColumns]);
  const apiSearchParams = React.useMemo(() => {
    const next = new URLSearchParams(searchParams.toString());
    next.delete('columns');
    next.delete('showPostTags');
    next.delete('post');
    return next;
  }, [searchParams]);

  const [draftSearch, setDraftSearch] = React.useState(urlSearch);
  const [syncedSearch, setSyncedSearch] = React.useState(urlSearch);
  // Adjusting during render rather than in an effect: a back navigation that
  // changes the query string updates the box in the same pass.
  if (syncedSearch !== urlSearch) {
    setSyncedSearch(urlSearch);
    setDraftSearch(urlSearch);
  }

  const requestUrl = React.useMemo(
    () =>
      apiUrl('/api/posts', apiSearchParams, landscapeId, {
        pageSize: PAGE_SIZE,
        sort,
        direction,
        page,
      }),
    [apiSearchParams, landscapeId, sort, direction, page],
  );
  const detailRequestUrl = React.useMemo(
    () => selectedPost
      ? apiUrl(
        '/api/posts/' + encodeURIComponent(selectedPost.id),
        apiSearchParams,
        landscapeId,
        { detailAttempt: detailAttempt || undefined },
      )
      : '',
    [selectedPost, apiSearchParams, landscapeId, detailAttempt],
  );

  // Loading is derived from "the URL we have data for is not the URL we want",
  // so no state is written synchronously inside the effect and the spinner can
  // never disagree with what is on screen.
  const [loaded, setLoaded] = React.useState<{
    url: string;
    data: Paged<PostDto> | null;
    error: string | null;
  }>({ url: '', data: null, error: null });

  const loading = loaded.url !== requestUrl;
  const result = loaded.data;
  const error = loaded.error;

  const [loadedDetail, setLoadedDetail] = React.useState<{
    url: string;
    data: PostDetailDto | null;
    error: string | null;
  }>({ url: '', data: null, error: null });
  const detailLoading = detailRequestUrl !== '' && loadedDetail.url !== detailRequestUrl;
  const detail = loadedDetail.url === detailRequestUrl ? loadedDetail.data : null;
  const detailError = loadedDetail.url === detailRequestUrl ? loadedDetail.error : null;

  React.useEffect(() => {
    let cancelled = false;
    const controller = new AbortController();
    fetch(requestUrl, { signal: controller.signal })
      .then(async (res) => {
        if (!res.ok) throw new Error('The posts service returned ' + res.status + '.');
        return (await res.json()) as Paged<PostDto>;
      })
      .then((data) => {
        if (!cancelled) setLoaded({ url: requestUrl, data, error: null });
      })
      .catch((err: unknown) => {
        if (cancelled || (err instanceof DOMException && err.name === 'AbortError')) return;
        setLoaded({
          url: requestUrl,
          data: null,
          error: err instanceof Error ? err.message : 'Could not reach the posts service.',
        });
      });
    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [requestUrl]);

  React.useEffect(() => {
    if (!detailRequestUrl) return;
    let cancelled = false;
    const controller = new AbortController();
    fetch(detailRequestUrl, { signal: controller.signal })
      .then(async (res) => {
        if (!res.ok) throw new Error('The post detail service returned ' + res.status + '.');
        return (await res.json()) as PostDetailDto;
      })
      .then((data) => {
        if (!cancelled) setLoadedDetail({ url: detailRequestUrl, data, error: null });
      })
      .catch((err: unknown) => {
        if (cancelled || (err instanceof DOMException && err.name === 'AbortError')) return;
        setLoadedDetail({
          url: detailRequestUrl,
          data: null,
          error: err instanceof Error ? err.message : 'Could not load the full post record.',
        });
      });
    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [detailRequestUrl]);

  const submitSearch = (e: React.FormEvent) => {
    e.preventDefault();
    setParams({ q: draftSearch || null, page: null });
  };

  const posts = result?.items ?? [];
  const displayedPosts = showPostTags ? posts : posts.map((post) => ({ ...post, tags: [] }));
  const total = result?.total ?? 0;
  const lastPage = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const exportHref = apiUrl('/api/posts/export', apiSearchParams, landscapeId, { sort, direction });
  const hasFilters =
    urlSearch.length > 0 ||
    getList('platforms').length > 0 ||
    getList('companies').length > 0 ||
    getList('tags').length > 0 ||
    getList('types').length > 0;

  const updateColumns = (next: PostColumnId[]) => {
    const ordered = POST_COLUMN_OPTIONS
      .map((column) => column.id)
      .filter((column) => next.includes(column));
    setParams(
      { columns: sameColumns(ordered, defaultColumns) ? null : ordered },
      { replace: true },
    );
  };

  const toggleColumn = (column: PostColumnId, checked: boolean) => {
    if (!checked && visibleColumns.length === 1) return;
    updateColumns(
      checked
        ? [...visibleColumns, column]
        : visibleColumns.filter((visible) => visible !== column),
    );
  };

  const selectPost = (post: PostDto) => {
    setSelectedPost(posts.find((candidate) => candidate.id === post.id) ?? post);
    // The open post rides in the URL so a link can land someone on the exact
    // dialog. "Where can I see the comments" should be answerable with a link,
    // not a set of directions.
    setParams({ post: post.id });
  };

  const closePost = () => {
    setSelectedPost(null);
    setParams({ post: null });
  };

  // Honor ?post= on arrival. If the post is in the loaded page, open it during
  // render, the same adjust-during-render pattern the search box uses, so no
  // setState runs synchronously inside an effect. A post outside the page is
  // fetched and down-mapped to the list shape, so a deep link works anywhere.
  const urlPostId = searchParams.get('post');
  const inPageLinked = urlPostId && selectedPost?.id !== urlPostId
    ? posts.find((candidate) => candidate.id === urlPostId)
    : undefined;
  if (inPageLinked && selectedPost?.id !== inPageLinked.id) {
    setSelectedPost(inPageLinked);
  }
  React.useEffect(() => {
    if (!urlPostId || selectedPost?.id === urlPostId) return;
    if (posts.some((candidate) => candidate.id === urlPostId)) return; // Render pass handles it.
    if (!result) return; // Wait for the page before deciding to fetch.
    let cancelled = false;
    fetch(apiUrl('/api/posts/' + encodeURIComponent(urlPostId), apiSearchParams, landscapeId, {}))
      .then(async (res) => {
        if (!res.ok) throw new Error(String(res.status));
        return (await res.json()) as PostDetailDto;
      })
      .then((full) => {
        if (cancelled) return;
        setSelectedPost({
          ...full,
          tags: full.tags.map(({ id, name, color }) => ({ id, name, color })),
          urls: full.urls.map(({ url, domain }) => ({ url, domain })),
        });
      })
      .catch(() => {
        // A dead link opens nothing rather than an error state.
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [urlPostId, result]);

  return (
    <div className="flex min-w-0 flex-col gap-4">
      <Card>
        <form onSubmit={submitSearch}>
          <div
            className={cn(
              'grid items-end gap-2 p-3',
              'sm:grid-cols-2',
              'xl:grid-cols-[minmax(24rem,1fr)_11rem_11rem_auto]',
            )}
          >
            <div className="min-w-0 sm:col-span-2 xl:col-span-1">
              <label
                htmlFor="posts-search"
                className="mb-1.5 block text-[10px] font-semibold uppercase tracking-wider text-zinc-400"
              >
                Search by
              </label>
              <div className="grid min-w-0 grid-cols-[auto_minmax(0,1fr)]">
                <span
                  aria-hidden
                  className={cn(
                    'inline-flex h-9 items-center rounded-l-md border border-r-0 border-zinc-200',
                    'bg-zinc-50 px-2.5 text-xs font-medium text-zinc-600',
                    'dark:border-zinc-800 dark:bg-zinc-950/50 dark:text-zinc-400',
                  )}
                >
                  Post Content or URL
                </span>
                <SearchInput
                  id="posts-search"
                  value={draftSearch}
                  onChange={(e) => setDraftSearch(e.target.value)}
                  placeholder="Enter text or paste a URL"
                  icon={<Search className="h-3.5 w-3.5" aria-hidden />}
                  aria-label="Search post content or URLs"
                  className="rounded-l-none"
                />
              </div>
            </div>

            <MultiSelect
              label="Post Type"
              options={POST_TYPES.map((t) => ({
                value: t,
                label: t[0].toUpperCase() + t.slice(1),
              }))}
              value={getList('types')}
              onChange={(next) => setParams({ types: next, page: null })}
            />
            <MultiSelect
              label="Post Tags"
              searchable={tags.length > 8}
              options={tags.map((t) => ({
                value: t.id,
                label: t.name,
                color: t.color ?? undefined,
              }))}
              value={getList('tags')}
              onChange={(next) => setParams({ tags: next, page: null })}
              allLabel={tags.length === 0 ? 'No tags defined' : 'All tags'}
            />

            <Button
              type="submit"
              variant="primary"
              className="w-full justify-center sm:col-span-2 xl:col-span-1 xl:w-auto"
            >
              Search
            </Button>
          </div>

          <div
            className={cn(
              'flex min-h-10 flex-wrap items-center justify-between gap-2',
              'border-t border-zinc-200 px-3 py-2 dark:border-zinc-800',
            )}
          >
            <p aria-live="polite" className="text-xs text-zinc-500 dark:text-zinc-400">
              {result ? (
                <>
                  <span className="pb-num font-semibold text-zinc-800 dark:text-zinc-200">
                    {total.toLocaleString('en-US')}
                  </span>
                  {' matching ' + (total === 1 ? 'post' : 'posts') + ' analyzed'}
                  {loading ? <span className="ml-2 text-zinc-400">Updating...</span> : null}
                </>
              ) : (
                'Analyzing matching posts...'
              )}
            </p>

            <div className="flex items-center gap-1.5">
              <Popover
                label="Search tips"
                align="end"
                panelClassName="w-72"
                trigger={({ open }) => (
                  <span
                    className={cn(
                      'inline-flex h-7 items-center rounded-md px-2 text-xs font-medium',
                      'text-zinc-500 transition-colors hover:bg-zinc-100 hover:text-zinc-900',
                      'dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-zinc-100',
                      open && 'bg-zinc-100 text-zinc-900 dark:bg-zinc-800 dark:text-zinc-100',
                    )}
                  >
                    Search tips
                  </span>
                )}
              >
                {() => (
                  <div className="space-y-2 p-3 text-xs leading-relaxed text-zinc-600 dark:text-zinc-400">
                    <p>Search checks captured post text and shared URLs.</p>
                    <p>Company, platform, post type, and post tag filters all narrow the same result set.</p>
                    <p>The full search and filter state is saved in this page&apos;s URL.</p>
                  </div>
                )}
              </Popover>
              {hasFilters ? (
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  onClick={() =>
                    setParams({
                      q: null,
                      platforms: null,
                      companies: null,
                      tags: null,
                      types: null,
                      page: null,
                    })
                  }
                >
                  Clear filters
                </Button>
              ) : null}
            </div>
          </div>
        </form>
      </Card>

      {summary}

      <Card className="min-w-0">
        <CardHeader className="items-start">
          <div className="min-w-0">
            <CardTitle>Top Landscape Posts</CardTitle>
            <p className="mt-1 text-[11px] text-zinc-500 dark:text-zinc-400">
              {loading && !result
                ? 'Loading ranked posts...'
                : total === 0
                  ? 'No posts in the current result set'
                  : 'Showing ' +
                    ((page - 1) * PAGE_SIZE + 1).toLocaleString('en-US') +
                    '–' +
                    Math.min(page * PAGE_SIZE, total).toLocaleString('en-US') +
                    ' of ' +
                    total.toLocaleString('en-US')}
            </p>
          </div>

          <CardToolbar className="w-full flex-wrap justify-start lg:w-auto lg:justify-end">
            <div className="flex items-center gap-1.5">
              <span className="text-[10px] font-semibold uppercase tracking-wider text-zinc-400">
                Post Tags
              </span>
              <ButtonGroup>
                <ButtonGroupItem
                  active={showPostTags}
                  onClick={() => setParams({ showPostTags: null }, { replace: true })}
                >
                  Show
                </ButtonGroupItem>
                <ButtonGroupItem
                  active={!showPostTags}
                  onClick={() => setParams({ showPostTags: '0' }, { replace: true })}
                >
                  Hide
                </ButtonGroupItem>
              </ButtonGroup>
            </div>

            <div className="flex items-center gap-1.5">
              <span className="text-[10px] font-semibold uppercase tracking-wider text-zinc-400">
                Layout
              </span>
              <ButtonGroup>
              <ButtonGroupItem
                active={view === 'table'}
                onClick={() => setParams({ view: null }, { replace: true })}
              >
                  <List className="h-3 w-3" aria-hidden />
                  List
              </ButtonGroupItem>
              <ButtonGroupItem
                active={view === 'grid'}
                onClick={() => setParams({ view: 'grid' }, { replace: true })}
              >
                <LayoutGrid className="h-3 w-3" aria-hidden />
                Details
              </ButtonGroupItem>
              <ButtonGroupItem
                active={view === 'mosaic'}
                onClick={() => setParams({ view: 'mosaic' }, { replace: true })}
              >
                <Grid3X3 className="h-3 w-3" aria-hidden />
                Mosaic
              </ButtonGroupItem>
              </ButtonGroup>
            </div>

            <Popover
              label="Manage table columns"
              align="end"
              panelClassName="w-64"
              trigger={({ open }) => (
                <PopoverTriggerSurface open={open} className="h-8 w-auto gap-1.5 px-2 text-xs">
                  <Columns3 className="h-3.5 w-3.5" aria-hidden />
                  Manage Columns
                </PopoverTriggerSurface>
              )}
            >
              {() => (
                <div className="p-3">
                  <div className="mb-3 flex items-center justify-between gap-3">
                    <div>
                      <p className="text-xs font-semibold text-zinc-900 dark:text-zinc-100">
                        Visible columns
                      </p>
                      <p className="mt-0.5 text-[11px] text-zinc-500">
                        {visibleColumns.length + ' of ' + POST_COLUMN_OPTIONS.length + ' selected'}
                      </p>
                    </div>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => updateColumns([...defaultColumns])}
                      disabled={sameColumns(visibleColumns, defaultColumns)}
                    >
                      Reset
                    </Button>
                  </div>
                  {(['Post details', 'Performance'] as const).map((group) => (
                    <div key={group} className="mb-3 last:mb-0">
                      <p className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-zinc-400">
                        {group}
                      </p>
                      <div className="space-y-2">
                        {POST_COLUMN_OPTIONS.filter((column) => column.group === group).map((column) => {
                          const checked = visibleColumns.includes(column.id);
                          return (
                            <Checkbox
                              key={column.id}
                              checked={checked}
                              disabled={checked && visibleColumns.length === 1}
                              onChange={(next) => toggleColumn(column.id, next)}
                              label={postColumnLabel(column, tablePlatform)}
                            />
                          );
                        })}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </Popover>

            <a
              href={exportHref}
              className={cn(
                'inline-flex h-8 items-center gap-1.5 rounded-md border px-2 text-xs font-medium',
                'border-zinc-200 text-zinc-700 transition-colors hover:bg-zinc-100',
                'dark:border-zinc-800 dark:text-zinc-300 dark:hover:bg-zinc-800',
              )}
              title="Download the current result set as CSV"
            >
              <FileDown className="h-3.5 w-3.5" aria-hidden />
              Export
            </a>
          </CardToolbar>
        </CardHeader>

        {error ? (
          <ErrorState compact message={error} onRetry={() => setParams({ _r: String(Date.now()) })} />
        ) : loading && !result ? (
          <div className="p-3">
            <SkeletonTable rows={8} cols={6} />
          </div>
        ) : view === 'table' ? (
          <div className={cn(loading && 'opacity-60 transition-opacity')}>
            <PostsTable
              posts={displayedPosts}
              sort={sort}
              direction={direction}
              visibleColumns={visibleColumns}
              platform={tablePlatform}
              onPostSelect={selectPost}
              onSortChange={(nextSort, nextDirection) =>
                setParams({ sort: nextSort, direction: nextDirection, page: null })
              }
              empty={<PostsEmpty />}
            />
          </div>
        ) : posts.length === 0 ? (
          <PostsEmpty />
        ) : view === 'grid' ? (
          <div className={cn('grid gap-3 p-3 sm:grid-cols-2 xl:grid-cols-3', loading && 'opacity-60')}>
            {displayedPosts.map((p) => (
              <PostCard key={p.id} post={p} onSelect={selectPost} />
            ))}
          </div>
        ) : (
          <PostMosaic
            posts={displayedPosts}
            onSelect={selectPost}
            className={cn(loading && 'opacity-60 transition-opacity')}
          />
        )}

        {total > PAGE_SIZE ? (
          <CardFooter>
            <span className="pb-num">
              {'Page ' + page + ' of ' + lastPage}
            </span>
            <span className="flex items-center gap-1">
              <Button
                size="sm"
                disabled={page <= 1}
                onClick={() => setParams({ page: page <= 2 ? null : String(page - 1) })}
              >
                <ChevronLeft className="h-3 w-3" aria-hidden />
                Previous
              </Button>
              <Button
                size="sm"
                disabled={page >= lastPage}
                onClick={() => setParams({ page: String(page + 1) })}
              >
                Next
                <ChevronRight className="h-3 w-3" aria-hidden />
              </Button>
            </span>
          </CardFooter>
        ) : null}
      </Card>

      <PostDetailDialog
        post={selectedPost}
        detail={detail}
        loading={detailLoading}
        error={detailError}
        onClose={closePost}
        onRetry={() => setDetailAttempt((attempt) => attempt + 1)}
      />
    </div>
  );
}

function PostsEmpty() {
  return (
    <EmptyState
      compact
      icon={FileText}
      title="No posts match these filters"
      description="Either nothing was published in this window, or the filters above are narrower than the data. Clearing the platform and post tag filters is usually the fastest way to find out which."
      action={{ label: 'Check ingest status', href: '/settings/sources' }}
    />
  );
}
