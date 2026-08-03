import type { NextRequest } from 'next/server';
import { sql } from 'drizzle-orm';
import { db } from '@/db';
import { apiHandler } from '@/lib/session';
import { coverageGaps, today } from '@/lib/metrics/daily-coverage';
import { assertCronAuthorized, cronJson } from '../../_lib/cron';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

/*
 * The last-chance sweep.
 *
 * Audience is a point-in-time reading. A channel not visited before midnight
 * has no follower count for that day, ever, and no later run can recover it.
 * The ordinary ingest cron is a schedule, which is a plan; this is the check
 * that the plan worked, run while there is still time to act on the answer.
 *
 * Timing is the whole design. It is scheduled at 01:00 and 03:00 UTC, which is
 * 20:00 or 21:00 Eastern depending on daylight saving, and 22:00 or 23:00 for
 * the second pass. Both are safely before Eastern midnight year-round, so a
 * channel found missing can still be collected on the day it is missing from.
 * A check that runs the next morning is not a safeguard, it is a post-mortem.
 *
 * It deliberately looks at audience_snapshots rather than at run status. A run
 * can finish, be recorded as a success, and write no snapshot at all, which is
 * what Reddit does today. The question is whether the reading exists.
 */

interface RunnerModule {
  runCollectionQueue: (opts: { maxChannels: number; postLimit: number }) => Promise<unknown>;
}

function isRunnerModule(mod: unknown): mod is RunnerModule {
  return typeof mod === 'object' && mod !== null
    && typeof (mod as { runCollectionQueue?: unknown }).runCollectionQueue === 'function';
}

async function handle(req: NextRequest): Promise<Response> {
  assertCronAuthorized(req);
  const day = today();

  const before = await coverageGaps(day);
  if (before.length === 0) {
    return cronJson({ ok: true, day, missingBefore: 0, requeued: 0, missingAfter: 0 });
  }

  /*
   * Jump the queue.
   *
   * These channels are not merely stale, they are about to lose a day that
   * cannot be recreated. next_attempt_at is set into the past so they sort
   * ahead of everything the ordinary schedule has waiting, and the lease is
   * cleared so a worker killed mid-run earlier today is not still holding them.
   */
  const ids = before.map((g) => g.channelId);
  await db.execute(sql`
    UPDATE channel_collection_state
       SET status = 'queued',
           next_attempt_at = now() - interval '1 hour',
           lease_until = NULL,
           lease_token = NULL
     WHERE channel_id = ANY(${ids}::uuid[])
       AND (lease_until IS NULL OR lease_until <= now())
  `);

  let ran = false;
  try {
    const runner = await import('@/lib/adapters/collection-queue');
    if (isRunnerModule(runner)) {
      // postLimit is small on purpose. This pass exists to capture a follower
      // count before midnight; back-history can wait for the ordinary cron.
      await runner.runCollectionQueue({ maxChannels: 60, postLimit: 50 });
      ran = true;
    }
  } catch (err) {
    console.error('[pressbox:cron/coverage] sweep failed', err);
  }

  const after = await coverageGaps(day);

  if (after.length > 0) {
    // Loud, because the alternative is finding out in a report next week.
    console.error(
      `[pressbox:cron/coverage] ${after.length} channels still have no audience reading for `
      + `${day}, and this day cannot be backfilled: `
      + after.slice(0, 20).map((g) => `${g.companyName}/${g.platform}`).join(', ')
      + (after.length > 20 ? ` and ${after.length - 20} more` : ''),
    );
  }

  return cronJson({
    ok: true,
    day,
    missingBefore: before.length,
    requeued: ids.length,
    ranQueue: ran,
    missingAfter: after.length,
    stillMissing: after.slice(0, 20).map((g) => ({
      company: g.companyName, platform: g.platform, handle: g.handle,
    })),
  });
}

export const GET = apiHandler(handle);
export const POST = apiHandler(handle);
