/**
 * /api/ingest/run -- the Refresh Data button.
 *
 * WHY A BUTTON AND NOT ONLY A SCHEDULE
 * A newsroom user looking at a competitive screen during a breaking story does
 * not care that the cron runs at the top of the hour. They need to know the
 * numbers in front of them are current, and if they are not, they need a way to
 * make them current that does not involve asking an engineer.
 *
 * The run is bounded rather than exhaustive: it refreshes the channels that are
 * most stale first and stops at a cap, because a serverless request has a
 * ceiling and a partial refresh that returns is worth more than a complete one
 * that times out. The response says exactly what it did so the UI can be honest
 * about what was and was not updated.
 */
import { z } from 'zod';
import { apiHandler, requireRole, HttpError } from '@/lib/session';
import { PLATFORMS } from '@/lib/types';
import { runAllDue } from "@/lib/adapters/runner";
import { readJson } from '../../_lib/query';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

const bodySchema = z.object({
  platforms: z.array(z.enum(PLATFORMS)).optional(),
  /** Cap on channels touched in one press. Keeps the request inside its budget. */
  limit: z.number().int().min(1).max(60).default(24),
  /** Days of history to request from each adapter. */
  sinceDays: z.number().int().min(1).max(90).default(14),
});

export const POST = apiHandler(async (req) => {
  const { orgId } = await requireRole('editor');
  const body = await readJson(req, bodySchema);

  const since = new Date(Date.now() - body.sinceDays * 864e5);

  try {
    const result = await runAllDue({
      orgId,
      platforms: body.platforms,
      since,
      until: new Date(),
      maxChannels: body.limit,
      limit: 120,
    });
    return Response.json(result);
  } catch (err) {
    throw new HttpError(
      500,
      err instanceof Error ? err.message : 'The refresh failed before it could start.',
      'ingest_failed',
    );
  }
});
