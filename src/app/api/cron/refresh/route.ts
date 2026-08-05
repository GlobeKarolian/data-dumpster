/**
 * /api/cron/refresh -- recovery wake-up for user-requested refresh jobs.
 *
 * This does not enqueue the estate or create new vendor demand. It only nudges
 * coordinators that a user already created, closing the gap when a chained
 * worker invocation is lost or a retry backoff becomes ready.
 */
import { after } from 'next/server';
import type { NextRequest } from 'next/server';
import { apiHandler } from '@/lib/session';
import { assertCronAuthorized, cronJson } from '../../_lib/cron';
import { dispatchRefreshJob } from '@/lib/adapters/refresh-dispatch';
import { claimRefreshRecoveryWake } from '@/lib/adapters/refresh-jobs';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

async function handle(req: NextRequest): Promise<Response> {
  assertCronAuthorized(req);
  const jobId = await claimRefreshRecoveryWake();
  if (jobId) {
    after(async () => {
      try {
        await dispatchRefreshJob(jobId);
      } catch (error) {
        console.error('[data-dumpster:cron/refresh] worker wake failed', {
          jobId,
          error: error instanceof Error ? error.message : 'Unknown dispatch failure.',
        });
      }
    });
  }
  return cronJson({ accepted: jobId ? 1 : 0 }, 202);
}

export const GET = apiHandler(handle);
export const POST = apiHandler(handle);
