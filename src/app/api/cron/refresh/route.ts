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
  // This sweep never calls a paid social vendor. It preserves a small batch of
  // the highest-engagement posters before their signed CDN references expire.
  after(async () => {
    try {
      const media = await import('@/lib/post-thumbnail-archive');
      const result = await media.archiveFacebookPostThumbnails({ limit: 4, concurrency: 2 });
      if (!result.skipped && (result.archived > 0 || result.unavailable > 0)) {
        console.info('[data-dumpster:cron/refresh] thumbnail archive sweep', result);
      }
    } catch (error) {
      // Refresh recovery remains independent from media retention.
      console.error('[data-dumpster:cron/refresh] thumbnail archive sweep failed', {
        error: error instanceof Error ? error.message : 'Unknown archive failure.',
      });
    }
  });
  return cronJson({ accepted: jobId ? 1 : 0 }, 202);
}

export const GET = apiHandler(handle);
export const POST = apiHandler(handle);
