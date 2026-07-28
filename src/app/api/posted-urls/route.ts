/**
 * GET /api/posted-urls?groupBy=domain|url
 *
 * What the landscape is actually driving traffic to. For a newsroom this is the
 * table that answers "are we promoting our own journalism or someone else's",
 * which is why it is a first-class screen here and an afterthought elsewhere.
 *
 * groupBy=domain (the default) rolls up to publisher; groupBy=url keeps
 * individual articles, deduplicated on canonical URL where one was resolved.
 */
import { z } from 'zod';
import type { NextRequest } from 'next/server';
import { apiHandler, requireOrg } from '@/lib/session';
import { getPostedUrls } from '@/lib/metrics/queries';
import { analyticsJson, resolveAnalyticsQuery } from '../_lib/query';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const groupBySchema = z.enum(['domain', 'url']).default('domain');

export const GET = apiHandler(async (req: NextRequest) => {
  const { orgId } = await requireOrg();
  const { query } = await resolveAnalyticsQuery(req, orgId);
  const groupBy = groupBySchema.parse(req.nextUrl.searchParams.get('groupBy') ?? undefined);
  return analyticsJson({ groupBy, rows: await getPostedUrls({ ...query, groupBy }) });
});
