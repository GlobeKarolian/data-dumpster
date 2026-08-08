/**
 * GET /api/analytics/leaderboard?metric=engagementRateByFollower
 *
 * One metric, every company in the landscape, ranked, with movement against the
 * previous window when compare is set. Defaults to engagementRateByFollower
 * because it is the only metric that is fair across audience sizes -- ranking a
 * metro daily against a public radio station on raw engagement is a vanity
 * chart, not a finding.
 */
import type { NextRequest } from 'next/server';
import { apiHandler, requireOrg } from '@/lib/session';
import { getLeaderboard } from '@/lib/metrics/queries';
import { analyticsJson, readMetric, resolveAnalyticsQuery } from '../../_lib/query';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const GET = apiHandler(async (req: NextRequest) => {
  const session = await requireOrg();
  const metric = readMetric(req, 'engagementRateByFollower');
  const { query } = await resolveAnalyticsQuery(req, session);
  return analyticsJson({ metric, rows: await getLeaderboard({ ...query, metric }) });
});
