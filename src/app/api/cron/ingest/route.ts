/**
 * /api/cron/ingest -- pull new posts and audience numbers for every due channel.
 *
 * GET and POST both work: Vercel Cron issues GET, and a human reaching for curl
 * during an incident should not have to remember that.
 *
 * The runner is imported dynamically rather than at module scope. Two reasons,
 * and the second is the important one:
 *
 *   1. Cold start. The runner pulls in every adapter and their HTTP stacks. This
 *      route is called frequently for queue recovery; unrelated requests
 *      that share a bundle should not pay for it.
 *   2. Failure isolation. If the ingestion module is missing or throws at import
 *      time -- mid-deploy, a bad env var, a half-shipped adapter -- a static
 *      import takes the whole route down with an opaque 500. Resolving it inside
 *      a try/catch turns that into an honest 503 that says which subsystem is
 *      unavailable, which is what an on-call engineer needs at 3am.
 */
import { z } from 'zod';
import type { NextRequest } from 'next/server';
import { apiHandler } from '@/lib/session';
import { assertCronAuthorized, cronJson } from '../../_lib/cron';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
/** Ingestion is the long pole; Vercel caps this at the plan maximum anyway. */
export const maxDuration = 300;

/*
 * Why vercel.json opens new collection windows every twelve hours.
 *
 * Audience is a point-in-time snapshot. A follower count is only knowable on
 * the day it is read, and a day that passes uncollected is missing forever;
 * there is no backfill for it. Every channel therefore has to be visited at
 * least once a day or the weekly report loses net change and growth rate.
 *
 * The full active estate fits below the 250-channel ceiling. A five-minute
 * request may still stop before the slow vendor tail settles, so offset recovery
 * ticks drain durable continuations and retries without opening a new window.
 *
 * New collection windows open twice daily. Separate recovery invocations call
 * this same route with mode=recover; they drain only already-queued work and
 * never reconcile fresh profiles into a third paid refresh.
 */
const paramsSchema = z.object({
  mode: z.enum(['scheduled', 'recover']).default('scheduled'),
  /*
   * Channels per invocation.
   *
   * The current estate fits below 250, leaving headroom for additional profiles
   * while keeping one serverless invocation bounded.
   */
  limit: z.coerce.number().int().min(1).max(250).default(24),
  /** Maximum posts read from one profile before pagination continues next batch. */
  postLimit: z.coerce.number().int().min(25).max(1000).default(500),
});

/**
 * The worker is imported inside the handler so a broken ingestion subsystem can
 * return an explicit 503 without taking unrelated application routes down.
 */
interface RunnerModule {
  enqueueTrackedProfiles: () => Promise<number>;
  runCollectionQueue: (opts: { maxChannels: number; postLimit: number }) => Promise<unknown>;
}

function isRunnerModule(mod: unknown): mod is RunnerModule {
  return typeof mod === 'object'
    && mod !== null
    && typeof (mod as { enqueueTrackedProfiles?: unknown }).enqueueTrackedProfiles === 'function'
    && typeof (mod as { runCollectionQueue?: unknown }).runCollectionQueue === 'function';
}

async function handle(req: NextRequest): Promise<Response> {
  assertCronAuthorized(req);
  const { mode, limit, postLimit } = paramsSchema.parse({
    mode: req.nextUrl.searchParams.get('mode') ?? undefined,
    limit: req.nextUrl.searchParams.get('limit') ?? undefined,
    postLimit: req.nextUrl.searchParams.get('postLimit') ?? undefined,
  });

  let runner: unknown;
  try {
    runner = await import('@/lib/adapters/collection-queue');
  } catch (err) {
    console.error('[pressbox:cron/ingest] runner failed to load', err);
    return cronJson(
      {
        ok: false,
        error: 'The ingestion runner is not available in this deployment.',
        code: 'runner_unavailable',
      },
      503,
    );
  }

  if (!isRunnerModule(runner)) {
    return cronJson(
      {
        ok: false,
        error: 'The ingestion runner is not available in this deployment.',
        code: 'runner_unavailable',
      },
      503,
    );
  }

  const startedAt = Date.now();
  let electionSources: unknown = null;
  if (mode === 'scheduled') {
    try {
      const elections = await import('@/lib/elections/source-connection');
      electionSources = await elections.connectPendingElectionSources({ limit: 20, concurrency: 3 });
    } catch (err) {
      // A newly supplied race URL must not prevent already-queued collection
      // from running. Leave the source durable and retry it next scheduled pass.
      console.error('[pressbox:cron/ingest] election source connection failed', err);
    }
  }
  // Recovery ticks are deliberately incapable of opening a new freshness
  // window. They only claim continuations, paid snapshot receipts and retries
  // that a twice-daily scheduled pass already placed in the durable queue.
  const queued = mode === 'scheduled' ? await runner.enqueueTrackedProfiles() : 0;
  let automaticCoordinators: unknown = null;
  let refreshJobs: typeof import('@/lib/adapters/refresh-jobs') | null = null;
  try {
    refreshJobs = await import('@/lib/adapters/refresh-jobs');
    if (mode === 'scheduled') {
      automaticCoordinators = await refreshJobs.startAutomaticRefreshCoordinators();
    }
  } catch (err) {
    // The global queue remains authoritative. A monitor-row failure must not
    // prevent already-enqueued paid work from running.
    console.error('[pressbox:cron/ingest] automatic monitor creation failed', err);
  }
  const result = await runner.runCollectionQueue({ maxChannels: limit, postLimit });
  let refreshJobsReconciled = 0;
  try {
    refreshJobs ??= await import('@/lib/adapters/refresh-jobs');
    refreshJobsReconciled = await refreshJobs.reconcileActiveRefreshJobs();
  } catch (err) {
    // Collection has already succeeded. A progress-row reconciliation failure
    // must be visible, but it must not turn that paid work into a false retry.
    console.error('[pressbox:cron/ingest] refresh job reconciliation failed', err);
  }
  return cronJson({
    ok: true,
    mode,
    limit,
    postLimit,
    electionSources,
    queued,
    automaticCoordinators,
    refreshJobsReconciled,
    durationMs: Date.now() - startedAt,
    result,
  });
}

export const GET = apiHandler(handle);
export const POST = apiHandler(handle);
