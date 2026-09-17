import { notFound } from 'next/navigation';
import { resolveContext } from '@/app/(app)/_lib/context';
import { getPosts, getLeaderboard, getPostDetail } from '@/lib/metrics/queries';
import { getIngestionCoverage } from '@/lib/metrics/ingestion-coverage';
import { createReader, ScopeUnavailable } from './reader';
import type { SearchParamsInput } from '@/app/(app)/_lib/data';
const reader = createReader({ context: resolveContext, posts: getPosts, leaderboard: getLeaderboard, detail: getPostDetail, coverage: getIngestionCoverage });
export async function readV2(mode: 'today' | 'compare' | 'posts', input: SearchParamsInput) {
  try { return await reader(mode, input); }
  catch (error) { if (error instanceof ScopeUnavailable) notFound(); throw error; }
}
