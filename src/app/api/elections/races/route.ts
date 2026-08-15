import { and, eq } from 'drizzle-orm';
import type { NextRequest } from 'next/server';
import { z } from 'zod';
import { db } from '@/db';
import {
  electionRaces,
  landscapes,
  userLandscapeAccess,
} from '@/db/schema';
import { readJson } from '@/app/api/_lib/query';
import { apiHandler, hasRole, HttpError, requireRole } from '@/lib/session';
import { slugify } from '@/lib/utils';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const createRaceSchema = z.object({
  name: z.string().trim().min(1).max(160),
  office: z.string().trim().min(1).max(120),
  jurisdiction: z.string().trim().min(1).max(160),
  electionDate: z.iso.date('Use a yyyy-mm-dd election date.').nullish(),
  description: z.string().trim().max(2000).nullish(),
}).strict();

export const POST = apiHandler(async (req: NextRequest) => {
  const session = await requireRole('editor');
  const body = await readJson(req, createRaceSchema);
  const suffix = body.electionDate ? '-' + body.electionDate.slice(0, 4) : '';
  const slug = slugify(body.name + suffix);
  if (!slug) {
    throw new HttpError(422, 'That race name has no usable characters for a URL.', 'invalid_name');
  }

  const [duplicate] = await db
    .select({ id: electionRaces.id })
    .from(electionRaces)
    .where(and(eq(electionRaces.orgId, session.orgId), eq(electionRaces.slug, slug)))
    .limit(1);
  if (duplicate) {
    throw new HttpError(409, 'A race with that name and cycle already exists.', 'duplicate_race');
  }

  const landscapeSlug = 'election-' + slug;
  const [landscapeCollision] = await db
    .select({ id: landscapes.id })
    .from(landscapes)
    .where(and(eq(landscapes.orgId, session.orgId), eq(landscapes.slug, landscapeSlug)))
    .limit(1);
  if (landscapeCollision) {
    throw new HttpError(
      409,
      'That race conflicts with an existing Election Center collection scope.',
      'duplicate_race_scope',
    );
  }

  const [landscape] = await db.insert(landscapes).values({
    orgId: session.orgId,
    name: body.name + (body.electionDate ? ' · ' + body.electionDate.slice(0, 4) : ''),
    slug: landscapeSlug,
    description: 'Internal Election Center collection scope for ' + body.name + '.',
    focusCompanyId: null,
  }).returning({ id: landscapes.id });

  try {
    const [race] = await db.insert(electionRaces).values({
      orgId: session.orgId,
      landscapeId: landscape.id,
      name: body.name,
      slug,
      office: body.office,
      jurisdiction: body.jurisdiction,
      electionDate: body.electionDate ?? null,
      status: 'setup',
      description: body.description ?? null,
    }).returning();

    if (!hasRole(session.role, 'admin')) {
      await db.insert(userLandscapeAccess).values({
        userId: session.userId,
        landscapeId: landscape.id,
        grantedBy: session.userId,
      }).onConflictDoNothing();
    }

    return Response.json({ ...race, candidateCount: 0, profileCount: 0 }, { status: 201 });
  } catch (error) {
    // Neon HTTP has no multi-statement transaction. This landscape was created
    // by this request and has no members yet, so removing it is the safe rollback.
    await db.delete(landscapes).where(eq(landscapes.id, landscape.id));
    throw error;
  }
});
