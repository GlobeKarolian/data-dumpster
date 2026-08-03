/**
 * /api/ingest/run -- the Refresh Data button.
 *
 * WHY A BUTTON AND NOT ONLY A SCHEDULE
 * A newsroom user looking at a competitive screen during a breaking story does
 * not care that the cron runs at the top of the hour. They need to know the
 * numbers in front of them are current, and if they are not, they need a way to
 * make them current that does not involve asking an engineer.
 *
 * One request processes a bounded slice, but the durable queue keeps the whole
 * selected landscape/window pending. Subsequent batches or the scheduled worker
 * continue from the same queue, so the cap is a timeout boundary rather than
 * data loss.
 */
import { z } from 'zod';
import { apiHandler, requireRole, HttpError } from '@/lib/session';
import { checkRateLimit, LIMITS } from '../../_lib/rate-limit';
import { PLATFORMS } from '@/lib/types';
import { db } from '@/db';
import { landscapes } from '@/db/schema';
import { and, eq } from 'drizzle-orm';
import {
  enqueueLandscapeCollection,
  runCollectionQueue,
} from '@/lib/adapters/collection-queue';
import { readJson } from '../../_lib/query';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

const bodySchema = z.object({
  platforms: z.array(z.enum(PLATFORMS)).optional(),
  landscapeId: z.uuid(),
  /** Cap on channels touched in one press. Keeps the request inside its budget. */
  limit: z.number().int().min(1).max(60).default(24),
  /** Days of history to request from each adapter. */
  sinceDays: z.number().int().min(1).max(365).default(28),
  /** False when the same button press is draining a queue it already created. */
  enqueue: z.boolean().default(true),
});

export const POST = apiHandler(async (req) => {
  const { orgId } = await requireRole('editor');
  // A full refresh is up to 60 channels of paid vendor calls.
  const gate = checkRateLimit(orgId, LIMITS.ingest);
  if (!gate.ok) throw new HttpError(429, gate.message, 'rate_limited');
  const body = await readJson(req, bodySchema);

  const [landscape] = await db
    .select({ id: landscapes.id })
    .from(landscapes)
    .where(and(eq(landscapes.id, body.landscapeId), eq(landscapes.orgId, orgId)))
    .limit(1);
  if (!landscape) {
    throw new HttpError(404, 'Landscape not found.', 'landscape_not_found');
  }

  const until = new Date();
  const since = new Date(until.getTime() - body.sinceDays * 864e5);

  try {
    if (body.enqueue) {
      await enqueueLandscapeCollection({
        orgId,
        landscapeId: body.landscapeId,
        platforms: body.platforms,
        since,
        until,
      });
    }
    const result = await runCollectionQueue({
      orgId,
      landscapeId: body.landscapeId,
      platforms: body.platforms,
      maxChannels: body.limit,
      postLimit: 500,
    });
    return Response.json(result);
  } catch (err) {
    /*
     * The message is logged, not returned.
     *
     * This handed the raw error text to the client, deliberately bypassing the
     * generic 500 in apiHandler whose own comment says Postgres errors leak
     * table and column names and must never reach a response body. An editor
     * could read the schema out of a failed refresh.
     */
    console.error('[pressbox:ingest/run] refresh failed', err);
    throw new HttpError(
      500,
      'The refresh failed before it could start. The error has been logged.',
      'ingest_failed',
    );
  }
});
