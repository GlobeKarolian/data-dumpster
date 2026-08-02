/**
 * POST /api/reports/[id]/recompute
 *
 * Throws the computed block away and derives it again from the warehouse. The
 * manual paste boxes are untouched. Narrative is cleared because every numeric
 * claim in it was verified against the computed snapshot being replaced.
 *
 * Recompute exists so that late-arriving data -- a platform backfill on
 * Tuesday, a channel reconnected on Wednesday -- can be picked up without
 * rebuilding the report. It is also the answer to the only question anyone
 * really asks of a weekly dashboard: is this current.
 */
import { apiHandler, requireRole, AuthError } from '@/lib/session';
import { and, eq } from 'drizzle-orm';
import { db } from '@/db';
import { weeklyReports } from '@/db/schema';
import { computeWeeklyReport } from '@/lib/reports/compute';
import { HttpError } from '@/lib/session';
import { loadReport, reportIdSchema, serializeReport } from '../../_lib';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 120;

export const POST = apiHandler<{ id: string }>(async (_req, ctx) => {
  const { orgId } = await requireRole('editor');
  const id = reportIdSchema.parse((await ctx.params).id);
  const existing = await loadReport(id, orgId);

  if (!existing.landscapeId) {
    throw new HttpError(
      422,
      'This report is not attached to a landscape, so there is nothing to compute from. '
      + 'The landscape it was built on was deleted.',
      'no_landscape',
    );
  }

  const computed = await computeWeeklyReport(
    orgId, existing.landscapeId, existing.periodStart, existing.periodEnd,
  );

  const [row] = await db
    .update(weeklyReports)
    .set({ computed, narrative: {}, updatedAt: new Date() })
    .where(and(eq(weeklyReports.id, id), eq(weeklyReports.orgId, orgId)))
    .returning();

  if (!row) throw new AuthError('not_found', 'That report does not exist.');
  return Response.json(serializeReport(row));
});
