/**
 * One parser for the query string every analytics endpoint accepts.
 *
 * Six endpoints share a filter vocabulary (landscape, window, platforms,
 * companies, tags, post types, granularity, compare). Parsing it in six places
 * is six chances for /leaderboard and /timeseries to disagree about what
 * "platforms=youtube,rss" means, and a chart that does not match the table under
 * it is worse than no chart. So: one schema, one resolver, one set of rules.
 *
 * The resolver is also where the tenant boundary is enforced. It returns a
 * Scoped<AnalyticsQuery> only after assertLandscapeInOrg has confirmed the
 * landscape belongs to the caller, so a handler physically cannot query metrics
 * for a landscape it did not prove ownership of.
 */
import { z } from 'zod';
import type { NextRequest } from 'next/server';
import { PLATFORMS, POST_TYPES, METRIC_KEYS } from '@/lib/types';
import type { AnalyticsQuery } from '@/lib/types';
import { parseRangeParams } from '@/lib/dates';
import { assertLandscapeInOrg, type LandscapeRef } from '@/lib/session';
import type { Scoped } from '@/lib/metrics/queries';

/**
 * Read a repeatable list parameter. Both "?platforms=a&platforms=b" and
 * "?platforms=a,b" are accepted because the first is what URLSearchParams
 * produces and the second is what people type.
 */
function listParam(sp: URLSearchParams, key: string): string[] | undefined {
  const raw = sp.getAll(key);
  if (raw.length === 0) return undefined;
  const values = raw
    .flatMap((v) => v.split(','))
    .map((v) => v.trim())
    .filter((v) => v.length > 0);
  return values.length > 0 ? values : undefined;
}

/** "?compare" with no value means true; only an explicit false turns it off. */
function boolParam(sp: URLSearchParams, key: string): boolean | undefined {
  if (!sp.has(key)) return undefined;
  const v = sp.get(key);
  if (v === null || v === '') return true;
  return !['0', 'false', 'no', 'off'].includes(v.toLowerCase());
}

export const RANGE_PRESETS = ['7d', '28d', '90d', '180d', '365d'] as const;

/**
 * Shape of the filters as they arrive on the wire. Dates stay as strings here;
 * turning them into a window is lib/dates' job, and it owns the preset table.
 */
export const analyticsParamsSchema = z.object({
  landscapeId: z.uuid('landscapeId must be a landscape UUID.'),
  start: z.iso.date().optional(),
  end: z.iso.date().optional(),
  range: z.enum(RANGE_PRESETS).optional(),
  platforms: z.array(z.enum(PLATFORMS)).min(1).optional(),
  companyIds: z.array(z.uuid()).min(1).optional(),
  tagIds: z.array(z.uuid()).min(1).optional(),
  postTypes: z.array(z.enum(POST_TYPES)).min(1).optional(),
  granularity: z.enum(['day', 'week', 'month']).optional(),
  compare: z.boolean().optional(),
});

export type AnalyticsParams = z.infer<typeof analyticsParamsSchema>;

/** Pull the shared filters out of a request URL, unvalidated shape aside. */
export function readAnalyticsParams(req: NextRequest): AnalyticsParams {
  const sp = req.nextUrl.searchParams;
  return analyticsParamsSchema.parse({
    landscapeId: sp.get('landscapeId') ?? undefined,
    start: sp.get('start') ?? undefined,
    end: sp.get('end') ?? undefined,
    range: sp.get('range') ?? undefined,
    platforms: listParam(sp, 'platforms'),
    companyIds: listParam(sp, 'companyIds'),
    tagIds: listParam(sp, 'tagIds'),
    postTypes: listParam(sp, 'postTypes'),
    granularity: sp.get('granularity') ?? undefined,
    compare: boolParam(sp, 'compare'),
  });
}

export interface ResolvedAnalyticsQuery {
  query: Scoped<AnalyticsQuery>;
  landscape: LandscapeRef;
}

/**
 * Validate, resolve the window, and prove the landscape belongs to the org.
 *
 * Note that orgId is threaded onto the query object rather than being trusted
 * from the caller: lib/metrics re-applies it as a hard guard in SQL, so even a
 * handler that forgot to check would still be scoped.
 */
export async function resolveAnalyticsQuery(
  req: NextRequest,
  orgId: string,
): Promise<ResolvedAnalyticsQuery> {
  const params = readAnalyticsParams(req);
  const landscape = await assertLandscapeInOrg(params.landscapeId, orgId);
  const { start, end } = parseRangeParams(req.nextUrl.searchParams);

  return {
    landscape,
    query: {
      orgId,
      landscapeId: landscape.id,
      start,
      end,
      platforms: params.platforms,
      companyIds: params.companyIds,
      tagIds: params.tagIds,
      postTypes: params.postTypes,
      granularity: params.granularity,
      compare: params.compare ?? false,
    },
  };
}

/** Leaderboards and time series additionally need to know which metric. */
export const metricParamSchema = z.enum(METRIC_KEYS);

export function readMetric(
  req: NextRequest,
  fallback: (typeof METRIC_KEYS)[number] = 'engagementTotal',
): (typeof METRIC_KEYS)[number] {
  const raw = req.nextUrl.searchParams.get('metric');
  return raw === null ? fallback : metricParamSchema.parse(raw);
}

/**
 * JSON responses from analytics endpoints are never cached by an intermediary.
 * The numbers are org-private and change on every ingest run.
 */
export function analyticsJson(body: unknown): Response {
  return Response.json(body, { headers: { 'cache-control': 'private, no-store' } });
}

/** Parse a JSON request body, surfacing a clean 400 rather than a parser crash. */
export async function readJson<T>(req: NextRequest, schema: z.ZodType<T>): Promise<T> {
  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    raw = undefined;
  }
  return schema.parse(raw);
}
