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
import { runNarrativeTick, type NarrativeTickResult } from '@/lib/tagging/narrative-jobs';
import { runGroupTaggingTick, type GroupTagTickResult } from '@/lib/tagging/group-queue';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
/** One completion per org, sequential; four orgs of 20 posts fit comfortably. */
export const maxDuration = 300;

async function handle(req: NextRequest): Promise<Response> {
  assertCronAuthorized(req);
  const orgIds = await orgsWithAiTags();
  const results: TagTickResult[] = [];
  const curation: CurationPassResult[] = [];
  const narratives: NarrativeTickResult[] = [];
  const groups: GroupTagTickResult[] = [];
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
      // Group posts run the same taxonomy through the same model, into their
      // own tables. They share the org's post-tagging budget, and run after
      // brand posts so brand coverage is never starved by group volume.
      const g = await runGroupTaggingTick(orgId);
      if (g.claimed > 0) groups.push(g);
    } catch (error) {
      console.error('[data-dumpster:cron/tag] group tick failed', {
        orgId,
        error: error instanceof Error ? error.message : 'Unknown group tagging failure.',
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
    try {
      // Day narratives: what drove each day of each running story. Budgeted
      // separately and skipped cheaply when nothing has changed.
      const pass = await runNarrativeTick(orgId);
      if (pass.written > 0 || pass.candidates > 0) narratives.push(pass);
    } catch (error) {
      console.error('[data-dumpster:cron/tag] narrative tick failed', {
        orgId,
        error: error instanceof Error ? error.message : 'Unknown narrative failure.',
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
    groupTagging: groups.map((g) => ({
      orgId: g.orgId,
      claimed: g.claimed,
      tagged: g.tagged,
      assignments: g.assignmentsWritten,
      failed: g.failed,
      spentUsd: Number(g.spentUsd.toFixed(4)),
      ...(g.budgetExhausted ? { budgetExhausted: true } : {}),
    })),
    narratives: narratives.map((n) => ({
      orgId: n.orgId,
      candidates: n.candidates,
      written: n.written,
      rejected: n.rejected,
      spentUsd: Number(n.spentUsd.toFixed(4)),
      ...(n.skipped ? { skipped: n.skipped } : {}),
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
