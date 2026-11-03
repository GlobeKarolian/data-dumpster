/**
 * /api/cron/bugs — finish triage for reports whose after-response triage
 * never completed (a crash, a timeout, a model outage mid-call).
 */
import type { NextRequest } from 'next/server';
import { apiHandler } from '@/lib/session';
import { assertCronAuthorized, cronJson } from '../../_lib/cron';
import { untriagedReportIds } from '@/lib/bugs/store';
import { triageBugReport } from '@/lib/bugs/triage';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

async function handle(req: NextRequest): Promise<Response> {
  assertCronAuthorized(req);
  const pending = await untriagedReportIds(10);
  let triaged = 0;
  for (const { id, orgId } of pending) {
    try {
      if (await triageBugReport(orgId, id)) triaged += 1;
    } catch (error) {
      console.error('[data-dumpster:cron/bugs] triage failed', {
        id,
        error: error instanceof Error ? error.message : 'Unknown triage failure.',
      });
    }
  }
  return cronJson({ pending: pending.length, triaged });
}

export const GET = apiHandler(handle);
export const POST = apiHandler(handle);
