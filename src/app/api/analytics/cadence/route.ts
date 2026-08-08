/**
 * GET /api/analytics/cadence
 *
 * The weekday-by-hour posting grid: how often the landscape publishes in each of
 * the 168 slots and how well those posts do. Always returns the full grid,
 * zero-filled, because an empty cell is a finding ("nobody posts Sunday at 6am")
 * rather than missing data, and a sparse response would make the heatmap lie.
 */
import type { NextRequest } from 'next/server';
import { apiHandler, requireOrg } from '@/lib/session';
import { getPostingCadence } from '@/lib/metrics/queries';
import { analyticsJson, resolveAnalyticsQuery } from '../../_lib/query';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const GET = apiHandler(async (req: NextRequest) => {
  const session = await requireOrg();
  const { query } = await resolveAnalyticsQuery(req, session);
  return analyticsJson({ cells: await getPostingCadence(query) });
});
