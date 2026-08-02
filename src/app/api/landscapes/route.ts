/**
 * /api/landscapes -- named competitive sets.
 *
 * GET  every landscape in the org with its members and focus company.
 * POST create one.
 *
 * A landscape is the unit of analysis in Data Dumpster: one focus company plus the
 * competitors it is measured against. Membership is stored in a join table so a
 * company can sit in several landscapes without duplication -- the Globe belongs
 * both in "Boston News" and in "Globe Owned Brands", and its numbers must be the
 * same in each.
 */
import { z } from 'zod';
import { and, asc, eq } from 'drizzle-orm';
import type { NextRequest } from 'next/server';
import { apiHandler, requireOrg, requireRole, HttpError } from '@/lib/session';
import { db } from '@/db';
import { companies, landscapeCompanies, landscapes } from '@/db/schema';
import { slugify } from '@/lib/utils';
import { readJson } from '../_lib/query';
import { assertCompaniesVisibleToOrg } from '../_lib/org-scope';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const createLandscapeSchema = z.object({
  name: z.string().trim().min(1).max(120),
  description: z.string().trim().max(2000).nullish(),
  focusCompanyId: z.uuid().nullish(),
  companyIds: z.array(z.uuid()).max(50).default([]),
});

export const GET = apiHandler(async () => {
  const { orgId } = await requireOrg();

  const rows = await db
    .select({
      id: landscapes.id,
      name: landscapes.name,
      slug: landscapes.slug,
      description: landscapes.description,
      focusCompanyId: landscapes.focusCompanyId,
      createdAt: landscapes.createdAt,
      memberId: companies.id,
      memberName: companies.name,
      memberSlug: companies.slug,
      memberColor: companies.color,
      memberLogoUrl: companies.logoUrl,
      sortOrder: landscapeCompanies.sortOrder,
    })
    .from(landscapes)
    .leftJoin(landscapeCompanies, eq(landscapeCompanies.landscapeId, landscapes.id))
    .leftJoin(companies, eq(companies.id, landscapeCompanies.companyId))
    .where(eq(landscapes.orgId, orgId))
    .orderBy(asc(landscapes.name), asc(landscapeCompanies.sortOrder));

  const byId = new Map<string, {
    id: string; name: string; slug: string; description: string | null;
    focusCompanyId: string | null; createdAt: Date;
    companies: { id: string; name: string; slug: string; color: string | null; logoUrl: string | null }[];
  }>();

  for (const r of rows) {
    const entry = byId.get(r.id) ?? {
      id: r.id, name: r.name, slug: r.slug, description: r.description,
      focusCompanyId: r.focusCompanyId, createdAt: r.createdAt, companies: [],
    };
    if (r.memberId && r.memberName && r.memberSlug) {
      entry.companies.push({
        id: r.memberId, name: r.memberName, slug: r.memberSlug,
        color: r.memberColor, logoUrl: r.memberLogoUrl,
      });
    }
    byId.set(r.id, entry);
  }

  return Response.json(
    { items: [...byId.values()] },
    { headers: { 'cache-control': 'private, no-store' } },
  );
});

export const POST = apiHandler(async (req: NextRequest) => {
  const { orgId } = await requireRole('editor');
  const body = await readJson(req, createLandscapeSchema);

  // The focus company is a member whether or not the caller listed it. A
  // landscape whose focus is not in its own set produces empty comparisons.
  const memberIds = await assertCompaniesVisibleToOrg(
    body.focusCompanyId ? [body.focusCompanyId, ...body.companyIds] : body.companyIds,
    orgId,
  );

  const slug = slugify(body.name);
  if (!slug) throw new HttpError(422, 'That name has no usable characters for a URL.', 'invalid_name');

  const [existing] = await db
    .select({ id: landscapes.id })
    .from(landscapes)
    .where(and(eq(landscapes.orgId, orgId), eq(landscapes.slug, slug)))
    .limit(1);
  if (existing) throw new HttpError(409, 'A landscape with that name already exists.', 'duplicate_landscape');

  const [created] = await db
    .insert(landscapes)
    .values({
      orgId,
      name: body.name,
      slug,
      description: body.description ?? null,
      focusCompanyId: body.focusCompanyId ?? null,
    })
    .returning();

  if (memberIds.length > 0) {
    await db.insert(landscapeCompanies).values(
      memberIds.map((companyId, i) => ({ landscapeId: created.id, companyId, sortOrder: i })),
    );
  }

  return Response.json({ ...created, companyIds: memberIds }, { status: 201 });
});
