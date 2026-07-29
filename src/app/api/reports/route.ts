/**
 * /api/reports -- the weekly report collection.
 *
 * GET  lists reports for the org, newest window first.
 * POST creates one and computes it in the same request.
 *
 * Creation computes rather than queueing. A report the user just asked for
 * should arrive populated; handing back an empty shell with a "computing"
 * badge would mean the first thing they see is the state this tool exists to
 * abolish -- a report full of numbers that are not there yet.
 *
 * The list deliberately omits the three jsonb columns. A season of reports
 * carries every follower figure and every pasted table, and the list screen
 * renders none of it. What it does need -- whether a report has been computed
 * at all, and how many manual boxes are still empty -- is read out of jsonb in
 * SQL and returned as counts.
 */
import { z } from 'zod';
import { and, desc, eq, sql } from 'drizzle-orm';
import type { NextRequest } from 'next/server';
import { apiHandler, assertLandscapeInOrg, requireOrg, requireRole, HttpError } from '@/lib/session';
import { db } from '@/db';
import { weeklyReports } from '@/db/schema';
import { computeWeeklyReport } from '@/lib/reports/compute';
import { defaultReportTitle, lastCompleteWeek } from '@/lib/reports/types';
import { readJson } from '../_lib/query';
import { daySchema, isUniqueViolation, serializeReport } from './_lib';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
/** A fact sheet plus five leaderboards over a busy landscape is not instant. */
export const maxDuration = 120;

const createSchema = z.object({
  landscapeId: z.uuid('landscapeId must be a landscape UUID.'),
  periodStart: daySchema.optional(),
  periodEnd: daySchema.optional(),
  title: z.string().trim().min(1).max(200).optional(),
  dataNote: z.string().trim().max(2_000).nullish(),
});

const listSchema = z.object({
  landscapeId: z.uuid().optional(),
  limit: z.coerce.number().int().min(1).max(200).default(60),
});

export const GET = apiHandler(async (req: NextRequest) => {
  const { orgId } = await requireOrg();
  const sp = req.nextUrl.searchParams;
  const params = listSchema.parse({
    landscapeId: sp.get('landscapeId') ?? undefined,
    limit: sp.get('limit') ?? undefined,
  });

  const where = params.landscapeId
    ? and(eq(weeklyReports.orgId, orgId), eq(weeklyReports.landscapeId, params.landscapeId))
    : eq(weeklyReports.orgId, orgId);

  const rows = await db
    .select({
      id: weeklyReports.id,
      landscapeId: weeklyReports.landscapeId,
      periodStart: weeklyReports.periodStart,
      periodEnd: weeklyReports.periodEnd,
      title: weeklyReports.title,
      dataNote: weeklyReports.dataNote,
      status: weeklyReports.status,
      updatedAt: weeklyReports.updatedAt,
      computedAt: sql<string | null>`${weeklyReports.computed} ->> 'generatedAt'`,
      manualTables: sql<number>`CASE
        WHEN jsonb_typeof(${weeklyReports.manual} -> 'tables') = 'object'
        THEN (SELECT count(*)::int FROM jsonb_object_keys(${weeklyReports.manual} -> 'tables'))
        ELSE 0 END`,
      narrativeSections: sql<number>`CASE
        WHEN jsonb_typeof(${weeklyReports.narrative}) = 'object'
        THEN (SELECT count(*)::int FROM jsonb_object_keys(${weeklyReports.narrative}))
        ELSE 0 END`,
    })
    .from(weeklyReports)
    .where(where)
    .orderBy(desc(weeklyReports.periodEnd), desc(weeklyReports.createdAt))
    .limit(params.limit);

  return Response.json(
    { items: rows },
    { headers: { 'cache-control': 'private, no-store' } },
  );
});

export const POST = apiHandler(async (req: NextRequest) => {
  const { orgId, userId } = await requireRole('editor');
  const body = await readJson(req, createSchema);
  const landscape = await assertLandscapeInOrg(body.landscapeId, orgId);

  const fallback = lastCompleteWeek();
  const period = {
    start: body.periodStart ?? fallback.start,
    end: body.periodEnd ?? fallback.end,
  };
  if (period.start > period.end) {
    throw new HttpError(422, 'The report period ends before it starts.', 'invalid_period');
  }

  const computed = await computeWeeklyReport(orgId, landscape.id, period.start, period.end);

  try {
    const [row] = await db
      .insert(weeklyReports)
      .values({
        orgId,
        landscapeId: landscape.id,
        periodStart: period.start,
        periodEnd: period.end,
        title: body.title ?? defaultReportTitle(period),
        dataNote: body.dataNote ?? null,
        computed,
        manual: { tables: {}, figures: {} },
        narrative: {},
        status: 'draft',
        createdBy: userId,
      })
      .returning();
    return Response.json(serializeReport(row), { status: 201 });
  } catch (err) {
    if (isUniqueViolation(err)) {
      throw new HttpError(
        409,
        'A report already exists for ' + period.start + ' to ' + period.end
        + '. Open it rather than starting a second one for the same week.',
        'duplicate_period',
      );
    }
    throw err;
  }
});
