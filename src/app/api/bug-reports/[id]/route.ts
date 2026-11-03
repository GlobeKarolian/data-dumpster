/**
 * /api/bug-reports/[id]
 *
 * GET: one report with its triage and diagnostics (admin).
 * PATCH: change status or resolution note, or rerun triage with
 * `{ "retriage": true }` after a fix to confirm the post now shows up.
 */
import type { NextRequest } from 'next/server';
import { z } from 'zod';
import { apiHandler, HttpError, requireRole } from '@/lib/session';
import { readJson } from '../../_lib/query';
import { BUG_STATUSES } from '@/lib/bugs/parse';
import { getBugReport, updateBugReport } from '@/lib/bugs/store';
import { triageBugReport } from '@/lib/bugs/triage';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 120;

const idSchema = z.uuid();
const patchSchema = z.object({
  status: z.enum(BUG_STATUSES).optional(),
  resolutionNote: z.string().trim().max(2000).nullable().optional(),
  retriage: z.boolean().optional(),
});

export const GET = apiHandler<{ id: string }>(async (_req, ctx) => {
  const session = await requireRole('admin');
  const id = idSchema.parse((await ctx.params).id);
  const report = await getBugReport(session.orgId, id);
  if (!report) throw new HttpError(404, 'Bug report not found.', 'not_found');
  return Response.json(report);
});

export const PATCH = apiHandler<{ id: string }>(async (req: NextRequest, ctx) => {
  const session = await requireRole('admin');
  const id = idSchema.parse((await ctx.params).id);
  const body = await readJson(req, patchSchema);
  if (body.status !== undefined || body.resolutionNote !== undefined) {
    const ok = await updateBugReport(session.orgId, id, {
      status: body.status,
      resolutionNote: body.resolutionNote,
    });
    if (!ok) throw new HttpError(404, 'Bug report not found.', 'not_found');
  }
  const report = body.retriage
    ? await triageBugReport(session.orgId, id)
    : await getBugReport(session.orgId, id);
  if (!report) throw new HttpError(404, 'Bug report not found.', 'not_found');
  return Response.json(report);
});
