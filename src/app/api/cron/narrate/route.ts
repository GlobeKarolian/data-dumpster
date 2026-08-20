/**
 * /api/cron/narrate — write the day narratives behind the story arcs.
 *
 * Separate from /api/cron/tag on purpose. Narratives are one model call per
 * story-day and the backlog after a taxonomy change runs to hundreds of days;
 * sharing the tagging tick's 300 seconds meant a dozen a run and tooltips that
 * stayed blank for hours. On its own schedule it drains steadily and can never
 * starve tagging, which is the job that actually feeds every other screen.
 */
import type { NextRequest } from 'next/server';
import { apiHandler } from '@/lib/session';
import { assertCronAuthorized, cronJson } from '../../_lib/cron';
import { orgsWithAiTags } from '@/lib/tagging/queue';
import { runNarrativeTick, type NarrativeTickResult } from '@/lib/tagging/narrative-jobs';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

async function handle(req: NextRequest): Promise<Response> {
  assertCronAuthorized(req);
  const orgIds = await orgsWithAiTags();
  const results: NarrativeTickResult[] = [];
  for (const orgId of orgIds) {
    try {
      results.push(await runNarrativeTick(orgId));
    } catch (error) {
      console.error('[data-dumpster:cron/narrate] org tick failed', {
        orgId,
        error: error instanceof Error ? error.message : 'Unknown narrative failure.',
      });
    }
  }
  return cronJson({
    orgs: orgIds.length,
    results: results.map((r) => ({
      orgId: r.orgId,
      candidates: r.candidates,
      written: r.written,
      rejected: r.rejected,
      spentUsd: Number(r.spentUsd.toFixed(4)),
      ...(r.skipped ? { skipped: r.skipped } : {}),
    })),
  });
}

export const GET = apiHandler(handle);
export const POST = apiHandler(handle);
