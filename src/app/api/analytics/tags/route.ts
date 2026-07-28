/**
 * GET /api/analytics/tags
 *
 * Performance by post tag -- the newsroom's own taxonomy (Sports, Politics,
 * Breaking News) rather than the platform's. Includes lift against the company
 * baseline, which is the number a desk editor actually acts on.
 *
 * Distinct from /api/tags, which manages the tag definitions themselves.
 */
import type { NextRequest } from 'next/server';
import { apiHandler, requireOrg } from '@/lib/session';
import { getTagPerformance } from '@/lib/metrics/queries';
import { analyticsJson, resolveAnalyticsQuery } from '../../_lib/query';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const GET = apiHandler(async (req: NextRequest) => {
  const { orgId } = await requireOrg();
  const { query } = await resolveAnalyticsQuery(req, orgId);
  return analyticsJson({ rows: await getTagPerformance(query) });
});
