/**
 * Scheduled: fill in plays for recent Instagram reels from Bright Data's Reels
 * dataset. See lib/instagram-plays/job.ts.
 */
import type { NextRequest } from 'next/server';
import { apiHandler } from '@/lib/session';
import { assertCronAuthorized, cronJson } from '../../_lib/cron';
import { runReelPlays } from '@/lib/instagram-plays/job';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

async function handle(req: NextRequest): Promise<Response> {
  assertCronAuthorized(req);
  const result = await runReelPlays();
  console.info('[data-dumpster:cron/instagram-plays]', result);
  return cronJson(result);
}

export const GET = apiHandler(handle);
export const POST = apiHandler(handle);
