/**
 * Scheduled, every minute: send every delivery that is due. RSS polling runs
 * here too, but only when PUBLISHING_RSS=true. See lib/publishing/.
 */
import type { NextRequest } from 'next/server';
import { apiHandler } from '@/lib/session';
import { assertCronAuthorized, cronJson } from '../../_lib/cron';
import { pollFeeds } from '@/lib/publishing/feeds';
import { dispatchDue } from '@/lib/publishing/dispatch';
import { publishingLive } from '@/lib/publishing/access';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 120;

async function handle(req: NextRequest): Promise<Response> {
  assertCronAuthorized(req);
  // RSS auto-post is switched off (Oct 2026). The code stays; set PUBLISHING_RSS=true to bring it back.
  const feeds = process.env.PUBLISHING_RSS === 'true'
    ? await pollFeeds().catch((err) => ({ error: (err as Error).message }))
    : { off: true };
  const sends = await dispatchDue();
  const result = { live: publishingLive(), feeds, sends };
  if (sends.claimed || ('queued' in feeds && feeds.queued)) console.info('[data-dumpster:cron/publish]', result);
  return cronJson(result);
}

export const GET = apiHandler(handle);
export const POST = apiHandler(handle);
