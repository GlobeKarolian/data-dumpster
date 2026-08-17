/**
 * /api/elections/races/[id]/candidates/[candidateId]/sources
 *
 * POST   add one or more accounts to an existing candidate. Candidates run
 *        several accounts on the same platform (personal, campaign, official),
 *        so this accepts a batch and lets the durable connection lease resolve
 *        each one independently. Duplicates of an already-supplied URL are
 *        ignored, never re-purchased.
 *
 * DELETE stop tracking one supplied account. This removes the election
 *        landscape's collection demand for the attached channel and detaches
 *        the intake row; pooled channel identity, posts and audience history
 *        are preserved so a later re-add reuses everything. Company and channel
 *        rows are never deleted here.
 */
import { and, eq } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '@/db';
import {
  electionCandidates,
  electionProfileSources,
  landscapeChannelDemands,
} from '@/db/schema';
import { readJson } from '@/app/api/_lib/query';
import { assertElectionRaceAccessible } from '@/lib/elections/access';
import { apiHandler, AuthError, requireRole } from '@/lib/session';
import { PLATFORMS } from '@/lib/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const paramsSchema = z.object({
  id: z.uuid('That is not a race id.'),
  candidateId: z.uuid('That is not a candidate id.'),
});

const addSourcesSchema = z.object({
  sources: z.array(z.object({
    platform: z.enum(PLATFORMS).refine((platform) => platform !== 'rss', 'RSS is not a social profile.'),
    url: z.url().max(2000),
    label: z.string().trim().max(80).nullish(),
    note: z.string().trim().max(1000).nullish(),
  }).strict()).min(1).max(20),
}).strict();

const removeSourceSchema = z.object({
  sourceId: z.uuid('That is not a source id.'),
}).strict();

async function assertCandidateInRace(raceId: string, candidateId: string) {
  const [candidate] = await db
    .select({ id: electionCandidates.id })
    .from(electionCandidates)
    .where(and(
      eq(electionCandidates.id, candidateId),
      eq(electionCandidates.raceId, raceId),
    ))
    .limit(1);
  if (!candidate) throw new AuthError('not_found', 'That candidate is not in this race.');
  return candidate;
}

export const POST = apiHandler<{ id: string; candidateId: string }>(async (req, ctx) => {
  const session = await requireRole('editor');
  const { id: raceId, candidateId } = paramsSchema.parse(await ctx.params);
  await assertElectionRaceAccessible(raceId, session);
  await assertCandidateInRace(raceId, candidateId);
  const body = await readJson(req, addSourcesSchema);

  const inserted = await db.insert(electionProfileSources).values(body.sources.map((source) => ({
    candidateId,
    platform: source.platform,
    url: source.url,
    label: source.label ?? null,
    status: 'pending' as const,
    note: source.note ?? null,
  }))).onConflictDoNothing().returning({ id: electionProfileSources.id });

  return Response.json({
    candidateId,
    requested: body.sources.length,
    added: inserted.length,
    duplicates: body.sources.length - inserted.length,
  }, { status: 201 });
});

export const DELETE = apiHandler<{ id: string; candidateId: string }>(async (req, ctx) => {
  const session = await requireRole('editor');
  const { id: raceId, candidateId } = paramsSchema.parse(await ctx.params);
  const race = await assertElectionRaceAccessible(raceId, session);
  await assertCandidateInRace(raceId, candidateId);
  const { sourceId } = await readJson(req, removeSourceSchema);

  const [source] = await db
    .select({
      id: electionProfileSources.id,
      candidateId: electionProfileSources.candidateId,
      channelId: electionProfileSources.channelId,
    })
    .from(electionProfileSources)
    .where(and(
      eq(electionProfileSources.id, sourceId),
      eq(electionProfileSources.candidateId, candidateId),
    ))
    .limit(1);
  if (!source) throw new AuthError('not_found', 'That account is not attached to this candidate.');

  /*
   * Stop-tracking order: demand first, intake row second. If the demand delete
   * fails, the intake row remains and nothing is lost; if the process dies
   * between the two, the orphaned demand is cleaned by the next attempt and
   * the channel simply stays fresh a little longer. Pooled observations,
   * identity and coverage are deliberately untouched.
   */
  if (source.channelId) {
    const [candidate] = await db
      .select({ companyId: electionCandidates.companyId })
      .from(electionCandidates)
      .where(eq(electionCandidates.id, candidateId))
      .limit(1);
    await db.delete(landscapeChannelDemands).where(and(
      eq(landscapeChannelDemands.landscapeId, race.landscapeId),
      eq(landscapeChannelDemands.channelId, source.channelId),
      eq(landscapeChannelDemands.companyId, candidate.companyId),
    ));
  }

  await db.delete(electionProfileSources).where(eq(electionProfileSources.id, source.id));
  return Response.json({ removed: sourceId, demandRemoved: source.channelId !== null });
});
