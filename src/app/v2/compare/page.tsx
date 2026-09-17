import * as React from 'react';
import { readV2 } from '@/lib/v2/server';
import { Workspace } from '@/components/v2/workspace';
import { CompareView } from '@/components/v2/compare-view';
import type { SearchParamsInput } from '@/app/(app)/_lib/data';
export default async function ComparePage({ searchParams }: { searchParams: Promise<SearchParamsInput> }) {
  const data = await readV2('compare', await searchParams);
  return <Workspace data={data} path="/v2/compare"><CompareView data={data} /></Workspace>;
}
