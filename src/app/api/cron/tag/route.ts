/**
 * /api/cron/tag — one AI-tagging tick per org with AI-eligible tags.
 *
 * Each tick claims a bounded batch of posts per org (new posts, posts whose
 * taxonomy fingerprint went stale, retries due), reads them in one completion
 * per org, and settles durable state. The queue design, the fingerprint that
 * drives recompute, and the spend ceiling are documented in
 * docs/AI-TAGGING.md.
 *
 * Orgs are processed sequentially, never batched into one prompt: one org's
 * taxonomy must not appear in another org's model call.
 */
import type { NextRequest } from 'next/server';
import { apiHandler } from '@/lib/session';
import { assertCronAuthorized, cronJson } from '../../_lib/cron';
import { orgsWithAiTags, runTaggingTick, type TagTickResult } from '@/lib/tagging/queue';
import { runCurationPass, type CurationPassResult } from '@/lib/tagging/curation';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
/** One completion per org, sequential; four orgs of 20 posts fit comfortably. */
export const maxDuration = 300;

async function handle(req: NextRequest): Promise<Response> {
  assertCronAuthorized(req);
  const orgIds = await orgsWithAiTags();
  const results: TagTickResult[] = [];
  const curation: CurationPassResult[] = [];
  for (const orgId of orgIds) {
    try {
      results.push(await runTaggingTick(orgId));
    } catch (error) {
      // One org's broken model connection must not starve the others.
      console.error('[data-dumpster:cron/tag] org tick failed', {
        orgId,
        error: error instanceof Error ? error.message : 'Unknown tagging failure.',
      });
    }
    try {
      // Vocabulary governance rides the same tick: the curator reads the
      // suggestion backlog and rules on groups with enough support. Cheap
      // no-op when the backlog is thin. See docs/AI-TAGGING.md.
      const pass = await runCurationPass(orgId);
      if (!pass.skipped || pass.groups > 0) curation.push(pass);
    } catch (error) {
      console.error('[data-dumpster:cron/tag] curation pass failed', {
        orgId,
        error: error instanceof Error ? error.message : 'Unknown curation failure.',
      });
    }
  }
  return cronJson({
    orgs: orgIds.length,
    results: results.map((r) => ({
      orgId: r.orgId,
      claimed: r.claimed,
      tagged: r.tagged,
      assignments: r.assignmentsWritten,
      dropped: r.droppedByValidation,
      failed: r.failed,
      spentUsd: Number(r.spentUsd.toFixed(4)),
      ...(r.budgetExhausted ? { budgetExhausted: true } : {}),
      ...(r.skipped ? { skipped: r.skipped } : {}),
    })),
    curation: curation.map((c) => ({
      orgId: c.orgId,
      groups: c.groups,
      covered: c.covered,
      created: c.created,
      rejected: c.rejected,
      queued: c.queued,
      spentUsd: Number(c.spentUsd.toFixed(4)),
      ...(c.skipped ? { skipped: c.skipped } : {}),
    })),
  });
}

export const GET = apiHandler(handle);
export const POST = apiHandler(handle);
