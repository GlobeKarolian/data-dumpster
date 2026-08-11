/**
 * Full post detail for a revocable public weekly-report link.
 *
 * The capability is deliberately narrower than the signed-in post endpoint: a
 * token may open only a post id frozen into that report's computed snapshot.
 * It cannot enumerate pooled posts or move outside the report's landscape and
 * date window.
 */
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '@/db';
import { weeklyReports } from '@/db/schema';
import { endOfZoneDay, parseLocalDay, startOfZoneDay } from '@/lib/dates';
import { getPostDetail } from '@/lib/metrics/queries';
import { sharedReportContainsPost } from '@/lib/reports/share-preview';
import { apiHandler, AuthError } from '@/lib/session';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const paramsSchema = z.object({
  token: z.string().regex(/^[A-Za-z0-9_-]{21}$/, 'That is not a valid report share token.'),
  id: z.uuid('That is not a post id.'),
});

export const GET = apiHandler<{ token: string; id: string }>(async (_req, ctx) => {
  const { token, id } = paramsSchema.parse(await ctx.params);
  const [report] = await db
    .select({
      orgId: weeklyReports.orgId,
      landscapeId: weeklyReports.landscapeId,
      periodStart: weeklyReports.periodStart,
      periodEnd: weeklyReports.periodEnd,
      computed: weeklyReports.computed,
    })
    .from(weeklyReports)
    .where(eq(weeklyReports.shareToken, token))
    .limit(1);

  if (
    !report
    || !report.landscapeId
    || !sharedReportContainsPost(report.computed, id)
  ) {
    throw new AuthError('not_found', 'That post is not part of this shared report.');
  }

  const parsedStart = parseLocalDay(report.periodStart);
  const parsedEnd = parseLocalDay(report.periodEnd);
  if (!parsedStart || !parsedEnd) {
    throw new Error('The shared report has an invalid date window.');
  }

  const detail = await getPostDetail({
    orgId: report.orgId,
    landscapeId: report.landscapeId,
    start: startOfZoneDay(parsedStart),
    end: endOfZoneDay(parsedEnd),
    postId: id,
  });
  if (!detail) {
    throw new AuthError('not_found', 'That post is no longer available in this report.');
  }

  return Response.json(detail, { headers: { 'cache-control': 'private, no-store' } });
});
