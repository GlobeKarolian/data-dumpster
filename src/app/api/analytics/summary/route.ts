/**
 * GET /api/analytics/summary
 *
 * The cross-channel overview: headline stats with deltas, platform mix, and the
 * focus company's best posts. Server Components call getSummary directly; this
 * route exists for client-side refetches and for anything outside the app that
 * wants the same numbers the UI is showing.
 */
import type { NextRequest } from 'next/server';
import { apiHandler, requireOrg } from '@/lib/session';
import { getSummary } from '@/lib/metrics/queries';
import { analyticsJson, resolveAnalyticsQuery } from '../../_lib/query';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const GET = apiHandler(async (req: NextRequest) => {
  const { orgId } = await requireOrg();
  const { query } = await resolveAnalyticsQuery(req, orgId);
  return analyticsJson(await getSummary(query));
});
