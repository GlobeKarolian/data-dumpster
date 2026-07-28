'use client';

import * as React from 'react';
import { ChevronLeft, ChevronRight, FileDown, FileText, LayoutGrid, Search, Table2 } from 'lucide-react';
import type { Paged } from '@/lib/types';
import { POST_TYPES, PLATFORM_COLORS, PLATFORM_LABELS, type Platform } from '@/lib/types';
import type { PostDto, SortKey } from '@/lib/metrics/contract';
import { cn } from '@/lib/utils';
import { Card, CardFooter, CardHeader, CardTitle, CardToolbar } from '@/components/ui/card';
import { Button, ButtonGroup, ButtonGroupItem } from '@/components/ui/button';
import { SearchInput } from '@/components/ui/input';
import { MultiSelect } from '@/components/ui/multi-select';
import { EmptyState } from '@/components/ui/empty-state';
import { ErrorState } from '@/components/ui/error-state';
import { SkeletonTable } from '@/components/ui/skeleton';
import { useUrlState } from '@/components/common/use-url-state';
import { apiUrl } from '@/components/common/api-params';
import { PostCard } from './post-card';
import { PostsTable } from './posts-table';

export interface PostsExplorerProps {
  landscapeId: string;
  companies: { id: string; name: string; color?: string | null }[];
  tags: { id: string; name: string; color: string | null }[];
  availablePlatforms: Platform[];
}

const PAGE_SIZE = 25;

/**
 * The posts explorer is the screen people live in, so its state lives in the
 * URL and its data comes from the API rather than from a server render: every
 * filter change has to feel like a filter change, not a page load.
 */
export function PostsExplorer({ landscapeId, companies, tags, availablePlatforms }: PostsExplorerProps) {
  const { searchParams, getList, setParams } = useUrlState();
  const [view, setView] = React.useState<'table' | 'grid'>('table');

  const sort = (searchParams.get('sort') as SortKey | null) ?? 'engagementTotal';
  const direction = searchParams.get('direction') === 'asc' ? 'asc' : 'desc';
  const page = Math.max(1, Number(searchParams.get('page') ?? '1') || 1);
  const urlSearch = searchParams.get('q') ?? '';

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
      apiUrl('/api/posts', searchParams, landscapeId, {
        pageSize: PAGE_SIZE,
        sort,
        direction,
        page,
      }),
    [searchParams, landscapeId, sort, direction, page],
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

  const submitSearch = (e: React.FormEvent) => {
    e.preventDefault();
    setParams({ q: draftSearch || null, page: null });
  };

  const posts = result?.items ?? [];
  const total = result?.total ?? 0;
  const lastPage = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const exportHref = apiUrl('/api/posts/export', searchParams, landscapeId, { sort, direction });

  return (
    <div className="flex flex-col gap-4 lg:flex-row">
      <aside className="w-full shrink-0 lg:w-56">
        <form onSubmit={submitSearch} className="space-y-3">
          <div>
            <label className="mb-1.5 block text-[10px] font-semibold uppercase tracking-wider text-zinc-400">
              Search
            </label>
            <SearchInput
              value={draftSearch}
              onChange={(e) => setDraftSearch(e.target.value)}
              placeholder="Caption text"
              icon={<Search className="h-3.5 w-3.5" aria-hidden />}
              aria-label="Search post captions"
            />
          </div>

          <div>
            <label className="mb-1.5 block text-[10px] font-semibold uppercase tracking-wider text-zinc-400">
              Filters
            </label>
            <div className="space-y-2">
              <MultiSelect
                label="Platform"
                options={availablePlatforms.map((p) => ({
                  value: p,
                  label: PLATFORM_LABELS[p],
                  color: PLATFORM_COLORS[p],
                }))}
                value={getList('platforms')}
                onChange={(next) => setParams({ platforms: next, page: null })}
              />
              <MultiSelect
                label="Company"
                searchable={companies.length > 8}
                options={companies.map((c) => ({ value: c.id, label: c.name, color: c.color ?? undefined }))}
                value={getList('companies')}
                onChange={(next) => setParams({ companies: next, page: null })}
              />
              <MultiSelect
                label="Tag"
                searchable={tags.length > 8}
                options={tags.map((t) => ({ value: t.id, label: t.name, color: t.color ?? undefined }))}
                value={getList('tags')}
                onChange={(next) => setParams({ tags: next, page: null })}
                allLabel={tags.length === 0 ? 'No tags defined' : 'All tags'}
              />
              <MultiSelect
                label="Post type"
                options={POST_TYPES.map((t) => ({ value: t, label: t[0].toUpperCase() + t.slice(1) }))}
                value={getList('types')}
                onChange={(next) => setParams({ types: next, page: null })}
              />
            </div>
          </div>

          <div className="flex items-center gap-2">
            <Button type="submit" variant="primary" size="sm" className="flex-1 justify-center">
              Apply
            </Button>
            <Button
              type="button"
              size="sm"
              onClick={() => setParams({ q: null, platforms: null, companies: null, tags: null, types: null, page: null })}
            >
              Reset
            </Button>
          </div>
        </form>
      </aside>

      <Card className="min-w-0 flex-1">
        <CardHeader>
          <CardTitle>
            {loading ? 'Loading posts' : total.toLocaleString('en-US') + (total === 1 ? ' post' : ' posts')}
          </CardTitle>
          <CardToolbar>
            <ButtonGroup>
              <ButtonGroupItem active={view === 'table'} onClick={() => setView('table')}>
                <Table2 className="h-3 w-3" aria-hidden />
                Table
              </ButtonGroupItem>
              <ButtonGroupItem active={view === 'grid'} onClick={() => setView('grid')}>
                <LayoutGrid className="h-3 w-3" aria-hidden />
                Grid
              </ButtonGroupItem>
            </ButtonGroup>
            <a
              href={exportHref}
              className="inline-flex h-7 items-center gap-1.5 rounded-md border border-zinc-200 px-2 text-xs font-medium text-zinc-700 transition-colors hover:bg-zinc-100 dark:border-zinc-800 dark:text-zinc-300 dark:hover:bg-zinc-800"
            >
              <FileDown className="h-3 w-3" aria-hidden />
              CSV
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
              posts={posts}
              sort={sort}
              direction={direction}
              onSortChange={(nextSort, nextDirection) =>
                setParams({ sort: nextSort, direction: nextDirection, page: null })
              }
              empty={<PostsEmpty />}
            />
          </div>
        ) : posts.length === 0 ? (
          <PostsEmpty />
        ) : (
          <div className={cn('grid gap-3 p-3 sm:grid-cols-2 xl:grid-cols-3', loading && 'opacity-60')}>
            {posts.map((p) => (
              <PostCard key={p.id} post={p} />
            ))}
          </div>
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
    </div>
  );
}

function PostsEmpty() {
  return (
    <EmptyState
      compact
      icon={FileText}
      title="No posts match these filters"
      description="Either nothing was published in this window, or the filters on the left are narrower than the data. Clearing the platform and tag filters is usually the fastest way to find out which."
      action={{ label: 'Check ingest status', href: '/settings/sources' }}
    />
  );
}
