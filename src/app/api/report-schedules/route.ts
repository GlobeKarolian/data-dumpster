import { and, desc, eq } from 'drizzle-orm';
import type { NextRequest } from 'next/server';
import { z } from 'zod';
import { db } from '@/db';
import { reportDeliveries, reportSchedules } from '@/db/schema';
import {
  apiHandler,
  assertLandscapeInOrg,
  requireOrg,
  requireRole,
} from '@/lib/session';
import { createReportScheduleSchema } from '@/lib/reports/schedule';
import { readJson } from '../_lib/query';
import { serializeReportSchedule } from './_lib';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const listSchema = z.object({
  landscapeId: z.uuid().optional(),
});

function serializeDelivery(row: typeof reportDeliveries.$inferSelect) {
  return {
    id: row.id,
    scheduleId: row.scheduleId,
    reportId: row.reportId,
    landscapeId: row.landscapeIdSnapshot,
    reportPeriod: row.reportPeriodStart && row.reportPeriodEnd
      ? { start: row.reportPeriodStart, end: row.reportPeriodEnd }
      : null,
    scheduledFor: row.scheduledFor,
    formats: row.formats,
    recipients: row.recipients,
    includeSlack: row.includeSlack,
    status: row.status,
    attemptCount: row.attemptCount,
    destinations: {
      email: {
        status: row.emailStatus,
        providerMessageId: row.emailProviderMessageId,
        error: row.emailError,
        attemptedAt: row.emailAttemptedAt?.toISOString() ?? null,
        finishedAt: row.emailFinishedAt?.toISOString() ?? null,
      },
      slack: {
        status: row.slackStatus,
        error: row.slackError,
        attemptedAt: row.slackAttemptedAt?.toISOString() ?? null,
        finishedAt: row.slackFinishedAt?.toISOString() ?? null,
      },
    },
    error: row.error,
    startedAt: row.startedAt.toISOString(),
    finishedAt: row.finishedAt?.toISOString() ?? null,
  };
}

export const GET = apiHandler(async (req: NextRequest) => {
  const { orgId } = await requireOrg();
  const params = listSchema.parse({
    landscapeId: req.nextUrl.searchParams.get('landscapeId') ?? undefined,
  });
  if (params.landscapeId) {
    await assertLandscapeInOrg(params.landscapeId, orgId);
  }

  const schedules = await db
    .select()
    .from(reportSchedules)
    .where(params.landscapeId
      ? and(
          eq(reportSchedules.orgId, orgId),
          eq(reportSchedules.landscapeId, params.landscapeId),
        )
      : eq(reportSchedules.orgId, orgId))
    .orderBy(desc(reportSchedules.createdAt));

  const deliveries = schedules.length === 0
    ? []
    : await db
        .select()
        .from(reportDeliveries)
        .where(eq(reportDeliveries.orgId, orgId))
        .orderBy(desc(reportDeliveries.startedAt))
        .limit(500);

  const deliveriesBySchedule = new Map<string, ReturnType<typeof serializeDelivery>[]>();
  for (const row of deliveries) {
    if (!row.scheduleId) continue;
    const existing = deliveriesBySchedule.get(row.scheduleId) ?? [];
    if (existing.length < 5) {
      existing.push(serializeDelivery(row));
      deliveriesBySchedule.set(row.scheduleId, existing);
    }
  }

  return Response.json(
    {
      items: schedules.map((row) => ({
        ...serializeReportSchedule(row),
        deliveries: deliveriesBySchedule.get(row.id) ?? [],
      })),
    },
    { headers: { 'cache-control': 'private, no-store' } },
  );
});

export const POST = apiHandler(async (req: NextRequest) => {
  const { orgId, userId } = await requireRole('admin');
  const body = await readJson(req, createReportScheduleSchema);
  await assertLandscapeInOrg(body.landscapeId, orgId);

  const [created] = await db
    .insert(reportSchedules)
    .values({
      orgId,
      landscapeId: body.landscapeId,
      name: body.name,
      recipients: body.recipients,
      formats: body.formats,
      includeSlack: body.includeSlack,
      dayOfWeek: body.dayOfWeek,
      hour: body.hour,
      timeZone: body.timeZone,
      enabled: body.enabled,
      createdBy: userId,
    })
    .returning();

  return Response.json(
    { ...serializeReportSchedule(created), deliveries: [] },
    { status: 201 },
  );
});
