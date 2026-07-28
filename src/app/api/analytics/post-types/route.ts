/**
 * GET /api/analytics/post-types
 *
 * Which formats earn their slot: photo versus reel versus link, compared on
 * engagement rate rather than raw totals so a format that is rarely used but
 * consistently strong is visible.
 */
import type { NextRequest } from 'next/server';
import { apiHandler, requireOrg } from '@/lib/session';
import { getPostTypePerformance } from '@/lib/metrics/queries';
import { analyticsJson, resolveAnalyticsQuery } from '../../_lib/query';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const GET = apiHandler(async (req: NextRequest) => {
  const { orgId } = await requireOrg();
  const { query } = await resolveAnalyticsQuery(req, orgId);
  return analyticsJson({ rows: await getPostTypePerformance(query) });
});
