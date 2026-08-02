import { and, eq } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '@/db';
import { reportSchedules } from '@/db/schema';
import { AuthError } from '@/lib/session';

export const reportScheduleIdSchema = z.uuid('That is not a report schedule id.');

export type ReportScheduleRow = typeof reportSchedules.$inferSelect;

export async function loadReportSchedule(
  id: string,
  orgId: string,
): Promise<ReportScheduleRow> {
  const [row] = await db
    .select()
    .from(reportSchedules)
    .where(and(eq(reportSchedules.id, id), eq(reportSchedules.orgId, orgId)))
    .limit(1);

  if (!row) {
    throw new AuthError('not_found', 'That report schedule does not exist.');
  }
  return row;
}

export function serializeReportSchedule(row: ReportScheduleRow) {
  return {
    id: row.id,
    landscapeId: row.landscapeId,
    name: row.name,
    recipients: row.recipients,
    formats: row.formats,
    includeSlack: row.includeSlack,
    dayOfWeek: row.dayOfWeek,
    hour: row.hour,
    timeZone: row.timeZone,
    enabled: row.enabled,
    lastRunAt: row.lastRunAt?.toISOString() ?? null,
    lastSuccessAt: row.lastSuccessAt?.toISOString() ?? null,
    lastError: row.lastError,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}
