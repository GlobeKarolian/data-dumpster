import 'server-only';

import { and, eq, inArray, sql } from 'drizzle-orm';
import { db } from '@/db';
import {
  electionCandidates,
  electionProfileSources,
  electionRaces,
} from '@/db/schema';
import { attachPublicProfile } from '@/lib/channels/attach-public-profile';
import { HttpError } from '@/lib/session';
import type { Platform } from '@/lib/types';

interface ClaimedSource extends Record<string, unknown> {
  id: string;
  candidate_id: string;
  platform: Platform;
  url: string;
  note: string | null;
}

interface SourceContext {
  sourceId: string;
  candidateId: string;
  raceId: string;
  companyId: string;
  orgId: string;
  platform: Platform;
  url: string;
  note: string | null;
}

export interface ElectionSourceConnectionResult {
  claimed: number;
  connected: number;
  review: number;
  retrying: number;
}

async function claimPendingSources(limit: number, raceId?: string): Promise<ClaimedSource[]> {
  const result = await db.execute<ClaimedSource>(sql`
    WITH claimable AS MATERIALIZED (
      SELECT eps.id
        FROM election_profile_sources eps
       WHERE (
         eps.status IN ('pending', 'paused')
         OR (
           eps.status = 'connecting'
           AND eps.updated_at < now() - interval '15 minutes'
         )
       )
         AND (
           ${raceId ?? null}::uuid IS NULL
           OR EXISTS (
             SELECT 1
               FROM election_candidates claim_candidate
              WHERE claim_candidate.id = eps.candidate_id
                AND claim_candidate.race_id = ${raceId ?? null}::uuid
           )
         )
       ORDER BY eps.updated_at ASC, eps.created_at ASC
       LIMIT ${limit}
       FOR UPDATE SKIP LOCKED
    )
    UPDATE election_profile_sources eps
       SET status = 'connecting', updated_at = now()
      FROM claimable
     WHERE eps.id = claimable.id
       AND (
         eps.status IN ('pending', 'paused')
         OR (
           eps.status = 'connecting'
           AND eps.updated_at < now() - interval '15 minutes'
         )
       )
    RETURNING eps.id, eps.candidate_id, eps.platform, eps.url, eps.note
  `);
  return [...result.rows];
}

async function loadContexts(claimed: readonly ClaimedSource[]): Promise<SourceContext[]> {
  if (claimed.length === 0) return [];
  const ids = claimed.map((source) => source.id);
  const rows = await db
    .select({
      sourceId: electionProfileSources.id,
      candidateId: electionCandidates.id,
      raceId: electionRaces.id,
      companyId: electionCandidates.companyId,
      orgId: electionRaces.orgId,
      platform: electionProfileSources.platform,
      url: electionProfileSources.url,
      note: electionProfileSources.note,
    })
    .from(electionProfileSources)
    .innerJoin(electionCandidates, eq(electionCandidates.id, electionProfileSources.candidateId))
    .innerJoin(electionRaces, eq(electionRaces.id, electionCandidates.raceId))
    .where(inArray(electionProfileSources.id, ids));
  return rows;
}

function shouldRetry(error: unknown): boolean {
  return !(error instanceof HttpError) || error.status >= 500;
}

async function connectOne(source: SourceContext): Promise<'connected' | 'review' | 'retrying'> {
  try {
    const result = await attachPublicProfile({
      companyId: source.companyId,
      orgId: source.orgId,
      platform: source.platform,
      profileInput: source.url,
      allowDeferredFacebookIdentity: true,
    });
    await db.update(electionProfileSources).set({
      status: 'connected',
      channelId: result.channel.id,
      // Remove the old Facebook onboarding warning. Editorial caveats supplied
      // for other sources remain attached to the race.
      note: source.platform === 'facebook' ? null : source.note,
      updatedAt: new Date(),
    }).where(eq(electionProfileSources.id, source.sourceId));
    await db.update(electionRaces).set({
      status: 'active',
      updatedAt: new Date(),
    }).where(and(
      eq(electionRaces.id, source.raceId),
      eq(electionRaces.status, 'setup'),
    ));
    return 'connected';
  } catch (error) {
    if (shouldRetry(error)) {
      await db.update(electionProfileSources).set({
        status: 'pending',
        note: source.note,
        updatedAt: new Date(),
      }).where(eq(electionProfileSources.id, source.sourceId));
      return 'retrying';
    }

    const conflict = error instanceof HttpError && [
      'pooled_account_identity_conflict',
      'pooled_account_conflict',
      'reassigned_handle',
    ].includes(error.code);
    await db.update(electionProfileSources).set({
      status: 'review',
      note: conflict
        ? error instanceof Error ? error.message : 'This source conflicts with an existing profile.'
        : 'The source could not confirm this supplied profile. Review the URL before retrying.',
      updatedAt: new Date(),
    }).where(eq(electionProfileSources.id, source.sourceId));
    return 'review';
  }
}

/**
 * Resolve supplied election URLs automatically and queue their first crawl.
 * The durable source row is the lease, so overlapping cron invocations cannot
 * purchase the same profile resolution twice.
 */
export async function connectPendingElectionSources(input: {
  limit?: number;
  concurrency?: number;
  raceId?: string;
} = {}): Promise<ElectionSourceConnectionResult> {
  const claimed = await claimPendingSources(
    Math.max(1, Math.min(input.limit ?? 20, 100)),
    input.raceId,
  );
  const contexts = await loadContexts(claimed);
  const concurrency = Math.max(1, Math.min(input.concurrency ?? 3, 10));
  const outcomes: Array<'connected' | 'review' | 'retrying'> = [];
  let next = 0;
  const workers = Array.from({ length: Math.min(concurrency, contexts.length) }, async () => {
    while (next < contexts.length) {
      const index = next++;
      outcomes[index] = await connectOne(contexts[index]);
    }
  });
  await Promise.all(workers);
  return {
    claimed: claimed.length,
    connected: outcomes.filter((outcome) => outcome === 'connected').length,
    review: outcomes.filter((outcome) => outcome === 'review').length,
    retrying: outcomes.filter((outcome) => outcome === 'retrying').length,
  };
}
