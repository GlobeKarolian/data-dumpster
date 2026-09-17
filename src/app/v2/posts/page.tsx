import * as React from 'react';
import { redirect } from 'next/navigation';
import { readV2 } from '@/lib/v2/server';
import { canonicalState, transitionUrl } from '@/lib/v2/state';
import { Workspace } from '@/components/v2/workspace';
import { PostsView } from '@/components/v2/posts-view';
import type { SearchParamsInput } from '@/app/(app)/_lib/data';
export default async function PostsPage({ searchParams }: { searchParams: Promise<SearchParamsInput> }) {
  const input = await searchParams;
  const data = await readV2('posts', input);
  const requestedPage = canonicalState(new URLSearchParams({ page: typeof input.page === 'string' ? input.page : '' })).page;
  if (requestedPage !== data.state.page) redirect(transitionUrl('/v2/posts', data.state));
  return <Workspace data={data} path="/v2/posts"><PostsView data={data} /></Workspace>;
}
