/**
 * POST /api/reports/[id]/narrative
 *
 * Drafts the prose for one section on the org's own model connection.
 *
 * The draft is returned rather than saved by default. A paragraph the author
 * has not read is not part of the report, and silently writing model output
 * into a document that goes to the chief executive is exactly the shortcut this
 * product does not take. Passing save=true is an explicit act.
 */
import { z } from 'zod';
import { and, eq } from 'drizzle-orm';
import { apiHandler, requireRole, AuthError, HttpError } from '@/lib/session';
import { db } from '@/db';
import { weeklyReports } from '@/db/schema';
import { draftNarrativeSection } from '@/lib/reports/narrative';
import { ReportNarrativeVerificationError } from '@/lib/reports/narrative-verification';
import { NARRATIVE_SECTIONS, readNarrative } from '@/lib/reports/types';
import { ModelError } from '@/lib/ai/types';
import { readJson } from '../../../_lib/query';
import { loadReport, orgName, reportIdSchema, toReportDocument } from '../../_lib';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
/** One completion, with retries on a slow endpoint. */
export const maxDuration = 180;

const SECTION_IDS = NARRATIVE_SECTIONS.map((s) => s.id) as [string, ...string[]];

const draftSchema = z.object({
  sectionId: z.enum(SECTION_IDS),
  connectionId: z.uuid().optional(),
  /** Write the draft straight into the report instead of returning it only. */
  save: z.boolean().default(false),
});

export const POST = apiHandler<{ id: string }>(async (req, ctx) => {
  const { orgId } = await requireRole('editor');
  const id = reportIdSchema.parse((await ctx.params).id);
  const body = await readJson(req, draftSchema);

  const row = await loadReport(id, orgId);
  const doc = toReportDocument(row, await orgName(orgId));

  let draft: Awaited<ReturnType<typeof draftNarrativeSection>>;
  try {
    draft = await draftNarrativeSection(orgId, body.sectionId, doc, {
      connectionId: body.connectionId,
    });
  } catch (err) {
    // A provider that refused is not our bug, and its message names the fix.
    if (err instanceof ModelError) throw new HttpError(502, err.message, 'model_error');
    if (err instanceof ReportNarrativeVerificationError) {
      throw new HttpError(422, err.message, 'unverified_narrative');
    }
    throw err;
  }

  if (!body.save) {
    return Response.json(draft, { headers: { 'cache-control': 'private, no-store' } });
  }

  const narrative = { ...readNarrative(row.narrative), [draft.sectionId]: draft.text };
  const [updated] = await db
    .update(weeklyReports)
    .set({ narrative, updatedAt: new Date() })
    .where(and(eq(weeklyReports.id, id), eq(weeklyReports.orgId, orgId)))
    .returning({ id: weeklyReports.id });

  if (!updated) throw new AuthError('not_found', 'That report does not exist.');
  return Response.json({ ...draft, saved: true });
});
