import { eq } from 'drizzle-orm';
import type { NextRequest } from 'next/server';
import { db } from '@/db';
import { reportSchedules } from '@/db/schema';
import { apiHandler } from '@/lib/session';
import { runReportSchedule } from '@/lib/reports/delivery';
import { isScheduleDue } from '@/lib/reports/schedule';
import { assertCronAuthorized, cronJson } from '../../_lib/cron';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

const CONCURRENCY = 2;

async function mapWithLimit<T, R>(
  items: T[],
  limit: number,
  worker: (item: T) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let cursor = 0;

  await Promise.all(Array.from(
    { length: Math.min(limit, items.length) },
    async () => {
      for (;;) {
        const index = cursor;
        cursor += 1;
        if (index >= items.length) return;
        results[index] = await worker(items[index]);
      }
    },
  ));
  return results;
}

async function handle(req: NextRequest): Promise<Response> {
  assertCronAuthorized(req);
  const now = new Date();
  const enabled = await db
    .select()
    .from(reportSchedules)
    .where(eq(reportSchedules.enabled, true));

  const due: typeof enabled = [];
  let invalid = 0;
  for (const schedule of enabled) {
    try {
      if (isScheduleDue(schedule, now)) due.push(schedule);
    } catch (err) {
      invalid += 1;
      console.error('[pressbox:cron/reports] invalid schedule ' + schedule.id, err);
    }
  }

  const outcomes = await mapWithLimit(due, CONCURRENCY, async (schedule) => {
    try {
      return await runReportSchedule(schedule, { now });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Scheduled report run failed.';
      console.error('[pressbox:cron/reports] schedule ' + schedule.id + ' failed', err);
      return {
        deliveryId: null,
        reportId: null,
        status: 'failed' as const,
        scheduledFor: null,
        emailId: null,
        delivered: { email: false, slack: false },
        error: message,
      };
    }
  });

  return cronJson({
    ok: outcomes.every((outcome) => outcome.status !== 'failed') && invalid === 0,
    schedulesEnabled: enabled.length,
    schedulesDue: due.length,
    schedulesInvalid: invalid,
    succeeded: outcomes.filter((outcome) => outcome.status === 'succeeded').length,
    skipped: outcomes.filter((outcome) => outcome.status === 'skipped').length,
    failed: outcomes.filter((outcome) => outcome.status === 'failed').length + invalid,
    outcomes,
  });
}

export const GET = apiHandler(handle);
export const POST = apiHandler(handle);
