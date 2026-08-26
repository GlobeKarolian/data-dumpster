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
import { readControl } from '@/lib/controls';
import { dispatchRefreshJob } from '@/lib/adapters/refresh-dispatch';
import { claimRefreshRecoveryWake } from '@/lib/adapters/refresh-jobs';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

async function handle(req: NextRequest): Promise<Response> {
  assertCronAuthorized(req);
  if (!(await readControl('refresh')).enabled) {
    return cronJson({ skipped: 'refresh is switched off by operator control' });
  }
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
      const facebook = await media.archiveFacebookPostThumbnails({ limit: 8, concurrency: 2 });
      // Instagram and Threads posters live on signed CDN URLs that expire in
      // days; archiving them while the URL still answers is the only chance.
      const direct = await media.archiveDirectPostThumbnails({ limit: 12, concurrency: 3 });
      for (const [label, result] of [['facebook', facebook], ['direct', direct]] as const) {
        if (!result.skipped && (result.archived > 0 || result.unavailable > 0)) {
          console.info(`[data-dumpster:cron/refresh] thumbnail archive sweep (${label})`, result);
        }
      }
    } catch (error) {
      // Refresh recovery remains independent from media retention.
      console.error('[data-dumpster:cron/refresh] thumbnail archive sweep failed', {
        error: error instanceof Error ? error.message : 'Unknown archive failure.',
      });
    }
  });
  // Candidate lookup attention: one free Wikimedia request per candidate,
  // once per UTC day. Wikimedia finalizes a day a few hours after it ends,
  // so the first tick past finalization pulls it and every later tick skips.
  after(async () => {
    try {
      const { sql: dsql } = await import('drizzle-orm');
      const { db: database } = await import('@/db');
      const { rows } = await database.execute<{ behind: boolean }>(dsql`
        SELECT coalesce(max(day) < (now() - interval '1 day')::date, true) AS behind
          FROM wikipedia_attention`);
      if (!rows[0]?.behind) return;
      const wiki = await import('@/lib/elections/wikipedia-attention');
      const result = await wiki.refreshCandidateAttention();
      console.info('[data-dumpster:cron/refresh] wikipedia attention refresh', result);
    } catch (error) {
      console.error('[data-dumpster:cron/refresh] wikipedia attention refresh failed', {
        error: error instanceof Error ? error.message : 'Unknown attention failure.',
      });
    }
  });
  return cronJson({ accepted: jobId ? 1 : 0 }, 202);
}

export const GET = apiHandler(handle);
export const POST = apiHandler(handle);
