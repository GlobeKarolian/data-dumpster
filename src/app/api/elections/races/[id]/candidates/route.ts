import { and, eq, sql } from 'drizzle-orm';
import type { NextRequest } from 'next/server';
import { z } from 'zod';
import { db } from '@/db';
import {
  companies,
  electionCandidates,
  electionProfileSources,
  landscapes,
} from '@/db/schema';
import { readJson } from '@/app/api/_lib/query';
import { assertElectionRaceAccessible } from '@/lib/elections/access';
import { apiHandler, HttpError, requireRole } from '@/lib/session';
import { slugify } from '@/lib/utils';
import { PLATFORMS } from '@/lib/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const idSchema = z.uuid('That is not a race id.');
const createCandidateSchema = z.object({
  name: z.string().trim().min(1).max(160),
  party: z.string().trim().max(80).nullish(),
  website: z.url().max(500).nullish(),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/, 'Use a six-digit hex color.').nullish(),
  incumbent: z.boolean().nullish(),
  sources: z.array(z.object({
    platform: z.enum(PLATFORMS).refine((platform) => platform !== 'rss', 'RSS is not a social profile.'),
    url: z.url().max(2000),
    note: z.string().trim().max(1000).nullish(),
  }).strict()).max(20).default([]),
}).strict();

export const POST = apiHandler<{ id: string }>(async (req: NextRequest, ctx) => {
  const session = await requireRole('editor');
  const raceId = idSchema.parse((await ctx.params).id);
  const race = await assertElectionRaceAccessible(raceId, session);
  const body = await readJson(req, createCandidateSchema);

  const companySlug = slugify(body.name);
  if (!companySlug) {
    throw new HttpError(422, 'That candidate name has no usable characters for a URL.', 'invalid_name');
  }

  let [company] = await db
    .select({ id: companies.id, name: companies.name })
    .from(companies)
    .where(eq(companies.slug, companySlug))
    .limit(1);

  if (!company) {
    const [created] = await db.insert(companies).values({
      orgId: session.orgId,
      name: body.name,
      slug: companySlug,
      website: body.website ?? null,
      segment: 'political candidate',
      color: body.color ?? '#52525B',
    }).onConflictDoNothing({ target: companies.slug }).returning({
      id: companies.id,
      name: companies.name,
    });
    company = created;

    if (!company) {
      [company] = await db
        .select({ id: companies.id, name: companies.name })
        .from(companies)
        .where(eq(companies.slug, companySlug))
        .limit(1);
    }
  }
  if (!company) throw new Error('The pooled candidate company could not be resolved.');

  const [alreadyInRace] = await db
    .select({ id: electionCandidates.id })
    .from(electionCandidates)
    .where(and(
      eq(electionCandidates.raceId, race.id),
      eq(electionCandidates.companyId, company.id),
    ))
    .limit(1);
  if (alreadyInRace) {
    throw new HttpError(409, company.name + ' is already in this race.', 'duplicate_candidate');
  }

  // Membership makes every candidate profile participate in the same pooled
  // scheduler. Existing history is reused if this person is tracked elsewhere.
  await db.execute(sql`
    INSERT INTO landscape_companies (landscape_id, company_id, sort_order)
    VALUES (
      ${race.landscapeId}::uuid,
      ${company.id}::uuid,
      coalesce((
        SELECT max(existing.sort_order) + 1
        FROM landscape_companies existing
        WHERE existing.landscape_id = ${race.landscapeId}::uuid
      ), 0)
    )
    ON CONFLICT (landscape_id, company_id) DO NOTHING
  `);

  const [candidate] = await db.insert(electionCandidates).values({
    raceId: race.id,
    companyId: company.id,
    party: body.party ?? null,
    candidateStatus: 'tracking',
    incumbent: body.incumbent ?? null,
  }).returning();

  if (body.sources.length > 0) {
    await db.insert(electionProfileSources).values(body.sources.map((source) => ({
      candidateId: candidate.id,
      platform: source.platform,
      url: source.url,
      status: source.platform === 'facebook' ? 'paused' : 'pending',
      note: source.note ?? null,
    }))).onConflictDoNothing();
  }

  // Existing analytics helpers expect a focus company. Election Center itself
  // treats the field symmetrically, but selecting the first candidate keeps the
  // internal collection scope valid for shared metric code and future exports.
  await db.update(landscapes).set({ focusCompanyId: company.id }).where(and(
    eq(landscapes.id, race.landscapeId),
    eq(landscapes.orgId, session.orgId),
    sql`${landscapes.focusCompanyId} IS NULL`,
  ));

  return Response.json({
    ...candidate,
    companyId: company.id,
    name: company.name,
    website: body.website ?? null,
    color: body.color ?? '#52525B',
    profiles: [],
    sources: body.sources,
  }, { status: 201 });
});
