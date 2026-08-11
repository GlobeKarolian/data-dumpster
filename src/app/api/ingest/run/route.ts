/**
 * /api/ingest/run -- start or rediscover a full background refresh.
 *
 * The request never performs vendor reads. It snapshots every matching profile
 * into the durable collection queue, returns a job handle immediately, and
 * lets bounded background invocations drain that scope ten profiles at a time.
 */
import { randomUUID } from 'node:crypto';
import { after } from 'next/server';
import { z } from 'zod';
import { apiHandler, requireOrg, HttpError, assertLandscapeAccessible } from '@/lib/session';
import { canTriggerManualRefresh } from '@/lib/manual-refresh-policy';
import { roleAtLeast } from '@/lib/roles';
import { checkRateLimit, LIMITS } from '../../_lib/rate-limit';
import { ADAPTER_SUPPORTED_PLATFORMS } from '@/lib/adapters/supported-platforms';
import {
  getActiveRefreshJobForLandscape,
  getActiveRefreshJobForScope,
  RefreshIdempotencyConflictError,
  startLandscapeRefresh,
} from '@/lib/adapters/refresh-jobs';
import {
  refreshWorkerUrl,
  runRefreshJobAndContinue,
} from '@/lib/adapters/refresh-dispatch';
import { readJson } from '../../_lib/query';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

const bodySchema = z.object({
  platforms: z.array(z.enum(ADAPTER_SUPPORTED_PLATFORMS)).optional(),
  landscapeId: z.uuid(),
  since: z.coerce.date(),
  until: z.coerce.date(),
}).superRefine((value, context) => {
  if (value.since > value.until) {
    context.addIssue({ code: 'custom', message: 'Refresh start must be on or before its end.' });
  }
  if (value.until.getTime() - value.since.getTime() > 734 * 86_400_000) {
    context.addIssue({ code: 'custom', message: 'Refresh windows cannot exceed two years.' });
  }
  if (value.until.getTime() > Date.now() + 36 * 60 * 60_000) {
    context.addIssue({ code: 'custom', message: 'Refresh end cannot be in the future.' });
  }
});

const activeQuerySchema = z.object({
  landscapeId: z.uuid(),
  platforms: z.array(z.enum(ADAPTER_SUPPORTED_PLATFORMS)).optional(),
  since: z.coerce.date(),
  until: z.coerce.date(),
}).refine((value) => value.since <= value.until, {
  message: 'Refresh start must be on or before its end.',
});

function platformQuery(req: Request): string[] | undefined {
  const values = new URL(req.url).searchParams
    .getAll('platforms')
    .flatMap((value) => value.split(','))
    .map((value) => value.trim())
    .filter(Boolean);
  return values.length > 0 ? values : undefined;
}

function assertBackgroundDispatchReady(): void {
  if (!process.env.CRON_SECRET) {
    throw new HttpError(
      503,
      'Background refresh is not configured on this deployment.',
      'refresh_worker_unavailable',
    );
  }
  try {
    refreshWorkerUrl();
  } catch {
    throw new HttpError(
      503,
      'Background refresh does not have a trusted deployment URL.',
      'refresh_worker_unavailable',
    );
  }
}

export const POST = apiHandler(async (req) => {
  const session = await requireOrg();
  if (!canTriggerManualRefresh(session.email)) {
    throw new HttpError(
      403,
      'Manual data refresh is limited to the designated data operators.',
      'manual_refresh_forbidden',
    );
  }
  const { orgId, userId } = session;
  const gate = checkRateLimit(orgId, LIMITS.ingest);
  if (!gate.ok) throw new HttpError(429, gate.message, 'rate_limited');
  const body = await readJson(req, bodySchema);
  await assertLandscapeAccessible(body.landscapeId, session);
  assertBackgroundDispatchReady();

  const idempotencyHeader = req.headers.get('idempotency-key')?.trim();
  const idempotencyKey = idempotencyHeader && idempotencyHeader.length <= 128
    ? idempotencyHeader
    : randomUUID();

  try {
    const started = await startLandscapeRefresh({
      orgId,
      userId,
      landscapeId: body.landscapeId,
      platforms: body.platforms,
      since: body.since,
      until: body.until,
      idempotencyKey,
      forceCollection: true,
    });
    if (started.snapshot.status === 'queued' || started.snapshot.status === 'running') {
      after(() => runRefreshJobAndContinue(started.snapshot.id));
    }
    return Response.json(
      { job: started.snapshot, reused: started.reused },
      {
        status: 202,
        headers: {
          'cache-control': 'private, no-store',
          location: '/api/ingest/jobs/' + started.snapshot.id,
        },
      },
    );
  } catch (error) {
    if (error instanceof RefreshIdempotencyConflictError) {
      throw new HttpError(409, error.message, 'idempotency_conflict');
    }
    console.error('[data-dumpster:ingest/run] refresh could not be queued', error);
    throw new HttpError(
      500,
      'The refresh could not be queued. The error has been logged.',
      'ingest_failed',
    );
  }
});

export const GET = apiHandler(async (req) => {
  const session = await requireOrg();
  if (!roleAtLeast(session.role, 'editor') && !canTriggerManualRefresh(session.email)) {
    throw new HttpError(403, 'Refresh status requires editor access.', 'forbidden');
  }
  const { orgId } = session;
  const query = activeQuerySchema.parse({
    landscapeId: req.nextUrl.searchParams.get('landscapeId') ?? undefined,
    platforms: platformQuery(req),
    since: req.nextUrl.searchParams.get('since') ?? undefined,
    until: req.nextUrl.searchParams.get('until') ?? undefined,
  });
  await assertLandscapeAccessible(query.landscapeId, session);
  const job = req.nextUrl.searchParams.get('monitor') === '1'
    ? await getActiveRefreshJobForLandscape({ orgId, landscapeId: query.landscapeId })
    : await getActiveRefreshJobForScope({
        orgId,
        landscapeId: query.landscapeId,
        platforms: query.platforms,
        since: query.since,
        until: query.until,
      });
  return Response.json({ job }, { headers: { 'cache-control': 'private, no-store' } });
});
