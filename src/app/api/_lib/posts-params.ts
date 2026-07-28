/**
 * Search, sort and pagination for the posts explorer and its CSV export.
 *
 * Lives here rather than in the route file so both endpoints share one
 * definition -- an export whose sort order silently disagreed with the table it
 * was exported from would be a quietly infuriating bug -- and so route.ts
 * exports nothing but HTTP methods and segment config.
 */
import { z } from 'zod';
import type { NextRequest } from 'next/server';
import type { SortKey } from '@/lib/metrics/contract';

export const POST_SORT_KEYS = [
  'engagementTotal', 'engagementRateByFollower', 'postedAt',
  'applause', 'conversation', 'amplification', 'views',
] as const satisfies readonly SortKey[];

export const postsParamsSchema = z.object({
  search: z.string().trim().min(1).max(200).optional(),
  sort: z.enum(POST_SORT_KEYS).default('engagementTotal'),
  direction: z.enum(['asc', 'desc']).default('desc'),
  page: z.coerce.number().int().min(1).max(10_000).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(25),
});

export type PostsParams = z.infer<typeof postsParamsSchema>;

export function readPostsParams(req: NextRequest): PostsParams {
  const sp = req.nextUrl.searchParams;
  return postsParamsSchema.parse({
    search: sp.get('search') ?? undefined,
    sort: sp.get('sort') ?? undefined,
    direction: sp.get('direction') ?? undefined,
    page: sp.get('page') ?? undefined,
    pageSize: sp.get('pageSize') ?? undefined,
  });
}
