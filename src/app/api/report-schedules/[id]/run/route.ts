import {
  apiHandler,
  assertLandscapeInOrg,
  HttpError,
  requireRole,
} from '@/lib/session';
import { runReportSchedule } from '@/lib/reports/delivery';
import { reportRunIdempotencyKeySchema } from '@/lib/reports/schedule';
import {
  loadReportSchedule,
  reportScheduleIdSchema,
} from '../../_lib';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

export const POST = apiHandler<{ id: string }>(async (req, ctx) => {
  const { orgId } = await requireRole('admin');
  const id = reportScheduleIdSchema.parse((await ctx.params).id);
  const schedule = await loadReportSchedule(id, orgId);
  await assertLandscapeInOrg(schedule.landscapeId, orgId);
  const rawKey = req.headers.get('idempotency-key');
  if (!rawKey) {
    throw new HttpError(
      400,
      'Run now requires an Idempotency-Key header so a retried request cannot send twice.',
      'idempotency_key_required',
    );
  }
  const idempotencyKey = reportRunIdempotencyKeySchema.parse(rawKey);
  const outcome = await runReportSchedule(schedule, {
    scheduledFor: 'manual:' + idempotencyKey,
  });
  return Response.json(outcome, {
    headers: { 'cache-control': 'private, no-store' },
  });
});
