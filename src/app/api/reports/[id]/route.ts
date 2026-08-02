/**
 * /api/reports/[id]
 *
 * GET    the whole report, jsonb columns normalized.
 * PATCH  the parts a human owns: title, banner note, manual paste boxes,
 *        narrative prose, status.
 * DELETE it.
 *
 * PATCH deliberately cannot write the computed block. That is not an oversight
 * or a missing feature -- it is the guarantee the whole design rests on. If a
 * computed figure could be edited through this endpoint then a computed figure
 * could be stale, and the difference between the two halves of this report
 * would stop meaning anything.
 */
import { z } from 'zod';
import { and, eq } from 'drizzle-orm';
import { apiHandler, requireOrg, requireRole, AuthError, HttpError } from '@/lib/session';
import { db } from '@/db';
import { weeklyReports } from '@/db/schema';
import {
  narrativeVerificationMessage,
  verifyReportNarrative,
} from '@/lib/reports/narrative-verification';
import { readJson } from '../../_lib/query';
import {
  loadReport,
  manualSchema,
  narrativeSchema,
  reportIdSchema,
  serializeReport,
  toReportDocument,
} from '../_lib';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const updateSchema = z.object({
  title: z.string().trim().min(1).max(200).optional(),
  dataNote: z.string().trim().max(2_000).nullish(),
  status: z.enum(['draft', 'final']).optional(),
  manual: manualSchema.optional(),
  narrative: narrativeSchema.optional(),
}).refine((body) => Object.keys(body).length > 0, 'Nothing to update.');

export const GET = apiHandler<{ id: string }>(async (_req, ctx) => {
  const { orgId } = await requireOrg();
  const id = reportIdSchema.parse((await ctx.params).id);
  const row = await loadReport(id, orgId);
  return Response.json(serializeReport(row), { headers: { 'cache-control': 'private, no-store' } });
});

export const PATCH = apiHandler<{ id: string }>(async (req, ctx) => {
  const { orgId } = await requireRole('editor');
  const id = reportIdSchema.parse((await ctx.params).id);
  const body = await readJson(req, updateSchema);

  // Prove ownership before writing, so a failed update cannot double as an
  // existence oracle for another org's report id.
  const existing = await loadReport(id, orgId);
  if (body.manual !== undefined || body.narrative !== undefined) {
    const current = toReportDocument(existing, '');
    const verification = verifyReportNarrative({
      ...current,
      manual: body.manual ?? current.manual,
      narrative: body.narrative ?? current.narrative,
    });
    if (!verification.ok) {
      throw new HttpError(
        422,
        narrativeVerificationMessage(verification),
        'unverified_narrative',
      );
    }
  }

  const [row] = await db
    .update(weeklyReports)
    .set({
      ...(body.title !== undefined ? { title: body.title } : {}),
      ...(body.dataNote !== undefined ? { dataNote: body.dataNote ?? null } : {}),
      ...(body.status !== undefined ? { status: body.status } : {}),
      ...(body.manual !== undefined ? { manual: body.manual } : {}),
      ...(body.narrative !== undefined ? { narrative: body.narrative } : {}),
      updatedAt: new Date(),
    })
    .where(and(eq(weeklyReports.id, id), eq(weeklyReports.orgId, orgId)))
    .returning();

  if (!row) throw new AuthError('not_found', 'That report does not exist.');
  return Response.json(serializeReport(row));
});

export const DELETE = apiHandler<{ id: string }>(async (_req, ctx) => {
  const { orgId } = await requireRole('editor');
  const id = reportIdSchema.parse((await ctx.params).id);

  const [row] = await db
    .delete(weeklyReports)
    .where(and(eq(weeklyReports.id, id), eq(weeklyReports.orgId, orgId)))
    .returning({ id: weeklyReports.id });

  if (!row) throw new AuthError('not_found', 'That report does not exist.');
  return new Response(null, { status: 204 });
});
