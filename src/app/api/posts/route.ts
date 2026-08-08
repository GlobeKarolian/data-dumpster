/**
 * GET /api/posts
 *
 * The Social Posts explorer. Same filter vocabulary as every analytics endpoint,
 * plus free-text search, sort and pagination.
 *
 * pageSize is clamped at 200 rather than rejected above it: a caller asking for
 * ten thousand rows wants an export, and there is an endpoint for that. See
 * /api/posts/export.
 */
import type { NextRequest } from 'next/server';
import { apiHandler, requireOrg } from '@/lib/session';
import { getPosts } from '@/lib/metrics/queries';
import { analyticsJson, resolveAnalyticsQuery } from '../_lib/query';
import { readPostsParams } from '../_lib/posts-params';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const GET = apiHandler(async (req: NextRequest) => {
  const session = await requireOrg();
  const { query } = await resolveAnalyticsQuery(req, session);
  const paging = readPostsParams(req);
  return analyticsJson(await getPosts({ ...query, ...paging }));
});
