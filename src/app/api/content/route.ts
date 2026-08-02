/**
 * /api/content -- the content analysis behind the Social Posts screen.
 *
 * It deliberately uses the same query parsers as /api/posts. A second parser
 * previously caused multi-value and screen/API filter dialects to diverge.
 */
import type { NextRequest } from 'next/server';
import { apiHandler, requireOrg } from '@/lib/session';
import { getContentAnalysis } from '@/lib/metrics/content-analysis';
import { analyticsJson, resolveAnalyticsQuery } from '../_lib/query';
import { readPostsParams } from '../_lib/posts-params';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export const GET = apiHandler(async (req: NextRequest) => {
  const { orgId } = await requireOrg();
  const { query } = await resolveAnalyticsQuery(req, orgId);
  const { search } = readPostsParams(req);
  return analyticsJson(await getContentAnalysis({
    landscapeId: query.landscapeId,
    orgId,
    start: query.start,
    end: query.end,
    platforms: query.platforms,
    companyIds: query.companyIds,
    postTypes: query.postTypes,
    tagIds: query.tagIds,
    search,
  }));
});
