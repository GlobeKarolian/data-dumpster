/**
 * /api/cron/backup — nightly off-Neon logical backup, resumable.
 *
 * Runs a bounded slice of the export, then chains another invocation of
 * itself while tables remain, the same worker-chaining shape the refresh
 * dispatcher uses. The manifest is only written when every table is done, so
 * a night interrupted by a platform hiccup shows up as a missing manifest —
 * visible in /api/health — rather than as a silently partial backup that
 * looks whole. Design notes in src/lib/backup.ts.
 */
import { after } from 'next/server';
import type { NextRequest } from 'next/server';
import { apiHandler } from '@/lib/session';
import { assertCronAuthorized, cronJson } from '../../_lib/cron';
import { runBackupSlice } from '@/lib/backup';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

const SLICE_BUDGET_MS = 240_000;

async function handle(req: NextRequest): Promise<Response> {
  assertCronAuthorized(req);
  const result = await runBackupSlice(SLICE_BUDGET_MS);

  if (!result.finished) {
    const url = new URL(req.url);
    const secret = process.env.CRON_SECRET ?? '';
    after(async () => {
      try {
        await fetch(`${url.origin}/api/cron/backup`, {
          method: 'POST',
          headers: { 'x-cron-secret': secret },
        });
      } catch (error) {
        console.error('[data-dumpster:cron/backup] chain invocation failed', {
          remaining: result.remaining.length,
          error: error instanceof Error ? error.message : 'Unknown chaining failure.',
        });
      }
    });
  }

  return cronJson({
    day: result.day,
    completedThisRun: result.completedThisRun.map((t) => ({
      table: t.table, rows: t.rows, kb: Math.round(t.bytes / 1024),
    })),
    remaining: result.remaining.length,
    finished: result.finished,
  });
}

export const GET = apiHandler(handle);
export const POST = apiHandler(handle);
