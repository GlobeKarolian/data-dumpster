/**
 * /api/ai/brief -- the written competitive brief.
 *
 * POST generate one for a landscape and window, and persist it.
 * GET  list what has already been written, newest first.
 *
 * Generation is deliberately synchronous. A brief is a document someone asked
 * for and is waiting on, and the honest thing to do is make them wait for it
 * rather than hand back a job id and a spinner that may never resolve. That is
 * also why maxDuration is the platform maximum: a fact sheet, a completion, a
 * verification pass and a possible repair turn is comfortably a minute of work
 * on a slow endpoint, and being killed at 60 seconds would burn the org's own
 * inference budget for nothing.
 *
 * The list response omits the stored fact sheet. It is the largest column in
 * the database -- every leaderboard, every top post, every number the model was
 * shown -- and sending sixty of them to render a list of titles would be a
 * multi-megabyte response for data no reader of that screen looks at. The
 * verification verdict is summarized inline instead, because whether a brief
 * can be trusted is exactly what the list has to convey.
 */
import { z } from 'zod';
import { and, count, desc, eq, sql } from 'drizzle-orm';
import type { NextRequest } from 'next/server';
import { apiHandler, assertLandscapeInOrg, requireOrg, requireRole, HttpError } from '@/lib/session';
import { db } from '@/db';
import { briefs } from '@/db/schema';
import { generateBrief, type GeneratedBrief } from '@/lib/ai/brief';
import { summarizeVerification } from '@/lib/ai/verify';
import { ModelError } from '@/lib/ai/types';
import { parseRangeParams } from '@/lib/dates';
import { readJson, RANGE_PRESETS } from '../../_lib/query';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
/** Fact sheet, completion, verification, and one repair turn. */
export const maxDuration = 300;

const generateSchema = z.object({
  landscapeId: z.uuid('landscapeId must be a landscape UUID.'),
  start: z.iso.date().optional(),
  end: z.iso.date().optional(),
  range: z.enum(RANGE_PRESETS).optional(),
  connectionId: z.uuid().optional(),
});

const listSchema = z.object({
  landscapeId: z.uuid('landscapeId must be a landscape UUID.'),
  page: z.coerce.number().int().min(1).max(10_000).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
});

/**
 * Reuse the analytics window resolver rather than reimplementing it, so a brief
 * generated for "28d" covers exactly the days the charts on screen covered.
 */
function rangeFromBody(body: { start?: string; end?: string; range?: string }) {
  const sp = new URLSearchParams();
  if (body.start) sp.set('start', body.start);
  if (body.end) sp.set('end', body.end);
  if (body.range) sp.set('range', body.range);
  return parseRangeParams(sp);
}

export const POST = apiHandler(async (req: NextRequest) => {
  const { orgId, userId } = await requireRole('editor');
  const body = await readJson(req, generateSchema);

  const landscape = await assertLandscapeInOrg(body.landscapeId, orgId);
  const range = rangeFromBody(body);

  let brief: GeneratedBrief;
  try {
    brief = await generateBrief(orgId, landscape.id, range, {
      connectionId: body.connectionId,
      createdBy: userId,
      persist: true,
    });
  } catch (err) {
    /**
     * A provider that refused is not a Pressbox bug, and its message already
     * names the fix ("re-enter the key", "no model is configured"). Passing it
     * through as a 502 gives the user something to act on; letting it fall to
     * the generic 500 handler would tell them only that something went wrong.
     */
    if (err instanceof ModelError) {
      throw new HttpError(502, err.message, 'model_error');
    }
    throw err;
  }

  return Response.json(
    {
      id: brief.id,
      landscapeId: landscape.id,
      title: brief.title,
      body: brief.body,
      periodStart: brief.periodStart,
      periodEnd: brief.periodEnd,
      modelUsed: brief.modelUsed,
      costUsd: brief.costUsd,
      latencyMs: brief.latencyMs,
      verification: brief.verification,
      verificationSummary: summarizeVerification(brief.verification),
    },
    { status: 201, headers: { 'cache-control': 'private, no-store' } },
  );
});

export const GET = apiHandler(async (req: NextRequest) => {
  const { orgId } = await requireOrg();
  const sp = req.nextUrl.searchParams;
  const params = listSchema.parse({
    landscapeId: sp.get('landscapeId') ?? undefined,
    page: sp.get('page') ?? undefined,
    pageSize: sp.get('pageSize') ?? undefined,
  });

  const landscape = await assertLandscapeInOrg(params.landscapeId, orgId);
  const scope = and(eq(briefs.orgId, orgId), eq(briefs.landscapeId, landscape.id));

  const [rows, [totals]] = await Promise.all([
    db
      .select({
        id: briefs.id,
        title: briefs.title,
        periodStart: briefs.periodStart,
        periodEnd: briefs.periodEnd,
        modelUsed: briefs.modelUsed,
        createdAt: briefs.createdAt,
        // Read the verdict out of jsonb in SQL; the sheet itself stays in the row.
        verifiedOk: sql<boolean | null>`(${briefs.facts} -> 'verification' ->> 'ok')::boolean`,
        claimsTotal: sql<number | null>`(${briefs.facts} -> 'verification' -> 'stats' ->> 'total')::int`,
        claimsGrounded: sql<number | null>`(${briefs.facts} -> 'verification' -> 'stats' ->> 'grounded')::int`,
        verificationSummary: sql<string | null>`${briefs.facts} -> 'generation' ->> 'summary'`,
      })
      .from(briefs)
      .where(scope)
      .orderBy(desc(briefs.periodEnd), desc(briefs.createdAt))
      .limit(params.pageSize)
      .offset((params.page - 1) * params.pageSize),
    db.select({ total: count() }).from(briefs).where(scope),
  ]);

  return Response.json(
    {
      items: rows,
      total: totals?.total ?? 0,
      page: params.page,
      pageSize: params.pageSize,
    },
    { headers: { 'cache-control': 'private, no-store' } },
  );
});
