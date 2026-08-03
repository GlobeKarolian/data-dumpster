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
 *      route is called eight times a day; the other several thousand requests
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
 * Why vercel.json schedules this every three hours.
 *
 * Audience is a point-in-time snapshot. A follower count is only knowable on
 * the day it is read, and a day that passes uncollected is missing forever;
 * there is no backfill for it. Every channel therefore has to be visited at
 * least once a day or the weekly report loses net change and growth rate.
 *
 * The arithmetic, measured rather than assumed: a full pass over the 138 active
 * channels is 965 seconds of serial wall time, which is 96 seconds at ten
 * concurrent workers. The whole estate therefore fits in one request, and the
 * per-run ceiling is 200 rather than 60 so a run is bounded by the clock rather
 * than by an arbitrary count.
 *
 * Eight runs a day is deliberate headroom, not eight times the data. Facebook
 * goes through a scraper whose successful calls take about two minutes each,
 * and a channel that misses its slot has to catch a later one the same day or
 * the reading is gone for good. The queue claims oldest-first with SKIP LOCKED,
 * so extra runs advance the stale tail instead of repeating the same work.
 *
 * Running it less often is how the estate ended up with six uneven days of
 * audience inside a seven-day window, and one day missing altogether.
 */
const paramsSchema = z.object({
  /*
   * Channels per invocation.
   *
   * The ceiling was 60 against an estate of 138, so no single run could ever
   * see more than 43% of it and the rest waited three hours for the next one.
   * At ten workers a full pass measures about 96 seconds, so the whole estate
   * now fits inside one request with room for the slow tail.
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
  const { limit, postLimit } = paramsSchema.parse({
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
  const queued = await runner.enqueueTrackedProfiles();
  const result = await runner.runCollectionQueue({ maxChannels: limit, postLimit });
  return cronJson({
    ok: true,
    limit,
    postLimit,
    queued,
    durationMs: Date.now() - startedAt,
    result,
  });
}

export const GET = apiHandler(handle);
export const POST = apiHandler(handle);
