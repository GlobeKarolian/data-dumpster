import * as React from 'react';
import { readV2 } from '@/lib/v2/server';
import { Workspace } from '@/components/v2/workspace';
import { TodayView } from '@/components/v2/today-view';
import type { SearchParamsInput } from '@/app/(app)/_lib/data';
export default async function TodayPage({ searchParams }: { searchParams: Promise<SearchParamsInput> }) {
  const data = await readV2('today', await searchParams);
  return <Workspace data={data} path="/v2"><TodayView data={data} /></Workspace>;
}
