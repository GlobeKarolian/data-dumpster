import { z } from 'zod';
import { and, eq } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import { db } from '@/db';
import { weeklyReports } from '@/db/schema';
import { apiHandler, AuthError, requireRole } from '@/lib/session';
import { readJson } from '../../../_lib/query';
import { loadReport, reportIdSchema } from '../../_lib';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const shareSchema = z.object({ enabled: z.boolean() });
const TOKEN_LENGTH = 21;

/** Mint or revoke the capability URL for a stored weekly report snapshot. */
export const POST = apiHandler<{ id: string }>(async (req, ctx) => {
  const session = await requireRole('editor');
  const id = reportIdSchema.parse((await ctx.params).id);
  const { enabled } = await readJson(req, shareSchema);

  // This also enforces the editor's per-landscape access before publication.
  await loadReport(id, session);
  const shareToken = enabled ? nanoid(TOKEN_LENGTH) : null;

  const [updated] = await db
    .update(weeklyReports)
    .set({ shareToken, updatedAt: new Date() })
    .where(and(eq(weeklyReports.id, id), eq(weeklyReports.orgId, session.orgId)))
    .returning({ id: weeklyReports.id, shareToken: weeklyReports.shareToken });

  if (!updated) throw new AuthError('not_found', 'That report does not exist.');
  return Response.json({
    id: updated.id,
    isShared: updated.shareToken !== null,
    shareUrl: updated.shareToken
      ? new URL('/report-share/' + updated.shareToken, req.nextUrl.origin).toString()
      : null,
  }, { headers: { 'cache-control': 'no-store' } });
});
