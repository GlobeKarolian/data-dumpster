/**
 * GET /api/analytics/timeseries?metric=engagementTotal&granularity=week
 *
 * One metric bucketed over time, one series per company. Granularity is optional
 * and lib/dates picks a sensible default from the window length, so a caller
 * asking for a year does not get 365 unreadable buckets.
 */
import type { NextRequest } from 'next/server';
import { apiHandler, requireOrg } from '@/lib/session';
import { getTimeSeries } from '@/lib/metrics/queries';
import { analyticsJson, readMetric, resolveAnalyticsQuery } from '../../_lib/query';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const GET = apiHandler(async (req: NextRequest) => {
  const { orgId } = await requireOrg();
  const metric = readMetric(req, 'engagementTotal');
  const { query } = await resolveAnalyticsQuery(req, orgId);
  return analyticsJson({ metric, ...(await getTimeSeries({ ...query, metric })) });
});
