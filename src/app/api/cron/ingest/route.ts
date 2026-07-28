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

const paramsSchema = z.object({
  /** Channels to process in one invocation. Kept modest so a run fits the timeout. */
  limit: z.coerce.number().int().min(1).max(500).default(50),
});

/**
 * The specifier is assembled at runtime rather than written as a literal.
 *
 * lib/adapters/runner is owned by the ingestion side of the codebase and may not
 * exist in every checkout or at every point in a deploy. A literal specifier
 * would make this route a compile error whenever that is true, which turns a
 * degraded subsystem into a broken build. Assembling the path keeps the bundler
 * resolving it from the adapters directory -- so the real module is still found
 * and code-split normally -- while leaving the failure to be handled at runtime,
 * where it can be reported honestly as a 503.
 */
const RUNNER_DIR = '@/lib/adapters/';
const RUNNER_MODULE = 'runner';

interface RunnerModule {
  runAllDue: (opts: { limit: number }) => Promise<unknown>;
}

function isRunnerModule(mod: unknown): mod is RunnerModule {
  return typeof mod === 'object'
    && mod !== null
    && typeof (mod as { runAllDue?: unknown }).runAllDue === 'function';
}

async function handle(req: NextRequest): Promise<Response> {
  assertCronAuthorized(req);
  const { limit } = paramsSchema.parse({
    limit: req.nextUrl.searchParams.get('limit') ?? undefined,
  });

  let runner: unknown;
  try {
    runner = await import(RUNNER_DIR + RUNNER_MODULE);
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
  const result = await runner.runAllDue({ limit });
  return cronJson({ ok: true, limit, durationMs: Date.now() - startedAt, result });
}

export const GET = apiHandler(handle);
export const POST = apiHandler(handle);
