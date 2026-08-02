import { and, eq } from 'drizzle-orm';
import { db } from '@/db';
import { reportSchedules } from '@/db/schema';
import {
  apiHandler,
  assertLandscapeInOrg,
  requireRole,
} from '@/lib/session';
import {
  createReportScheduleSchema,
  updateReportScheduleSchema,
} from '@/lib/reports/schedule';
import { readJson } from '../../_lib/query';
import {
  loadReportSchedule,
  reportScheduleIdSchema,
  serializeReportSchedule,
} from '../_lib';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const PATCH = apiHandler<{ id: string }>(async (req, ctx) => {
  const { orgId } = await requireRole('admin');
  const id = reportScheduleIdSchema.parse((await ctx.params).id);
  const body = await readJson(req, updateReportScheduleSchema);
  const existing = await loadReportSchedule(id, orgId);

  const merged = createReportScheduleSchema.parse({
    landscapeId: body.landscapeId ?? existing.landscapeId,
    name: body.name ?? existing.name,
    recipients: body.recipients ?? existing.recipients,
    formats: body.formats ?? existing.formats,
    includeSlack: body.includeSlack ?? existing.includeSlack,
    dayOfWeek: body.dayOfWeek ?? existing.dayOfWeek,
    hour: body.hour ?? existing.hour,
    timeZone: body.timeZone ?? existing.timeZone,
    enabled: body.enabled ?? existing.enabled,
  });
  await assertLandscapeInOrg(merged.landscapeId, orgId);

  const [updated] = await db
    .update(reportSchedules)
    .set({
      landscapeId: merged.landscapeId,
      name: merged.name,
      recipients: merged.recipients,
      formats: merged.formats,
      includeSlack: merged.includeSlack,
      dayOfWeek: merged.dayOfWeek,
      hour: merged.hour,
      timeZone: merged.timeZone,
      enabled: merged.enabled,
      updatedAt: new Date(),
    })
    .where(and(
      eq(reportSchedules.id, existing.id),
      eq(reportSchedules.orgId, orgId),
    ))
    .returning();

  return Response.json(serializeReportSchedule(updated));
});

export const DELETE = apiHandler<{ id: string }>(async (_req, ctx) => {
  const { orgId } = await requireRole('admin');
  const id = reportScheduleIdSchema.parse((await ctx.params).id);
  await loadReportSchedule(id, orgId);

  await db
    .delete(reportSchedules)
    .where(and(
      eq(reportSchedules.id, id),
      eq(reportSchedules.orgId, orgId),
    ));

  return new Response(null, { status: 204 });
});
