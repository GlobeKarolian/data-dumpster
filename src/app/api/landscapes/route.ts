/**
 * /api/landscapes -- named competitive sets.
 *
 * GET  every landscape the caller may access, with members and focus company.
 * POST create one, optionally creating its focus company in the same request.
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
import { apiHandler, requireOrg, requireRole, hasRole, HttpError } from '@/lib/session';
import { db } from '@/db';
import {
  companies,
  landscapeCompanies,
  landscapes,
  userLandscapeAccess,
} from '@/db/schema';
import { slugify } from '@/lib/utils';
import { readJson } from '../_lib/query';
import { assertCompaniesVisibleToUser } from '../_lib/org-scope';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const inlineCompanySchema = z.object({
  name: z.string().trim().min(1).max(160),
  website: z.url().max(500).nullish(),
  logoUrl: z.url().max(500).nullish(),
  segment: z.string().trim().max(80).nullish(),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/, 'Use a six-digit hex color.').nullish(),
});

const createLandscapeSchema = z.object({
  name: z.string().trim().min(1).max(120),
  description: z.string().trim().max(2000).nullish(),
  focusCompanyId: z.uuid().nullish(),
  newFocusCompany: inlineCompanySchema.nullish(),
  companyIds: z.array(z.uuid()).max(50).default([]),
}).superRefine((body, ctx) => {
  // A focus company is deliberately optional. Plenty of real landscapes are a
  // market watched from outside (all 30 MLB clubs, a neighboring metro), where
  // "which brand is ours" has no answer. PATCH has always allowed null here;
  // requiring it only at creation forced people to invent a focus they then
  // never meant.
  if (body.focusCompanyId && body.newFocusCompany) {
    ctx.addIssue({
      code: 'custom',
      path: ['newFocusCompany'],
      message: 'Use either an existing focus company or a new one, not both.',
    });
  }
});

export const GET = apiHandler(async () => {
  const session = await requireOrg();

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
    .leftJoin(
      userLandscapeAccess,
      and(
        eq(userLandscapeAccess.landscapeId, landscapes.id),
        eq(userLandscapeAccess.userId, session.userId),
      ),
    )
    .leftJoin(landscapeCompanies, eq(landscapeCompanies.landscapeId, landscapes.id))
    .leftJoin(companies, eq(companies.id, landscapeCompanies.companyId))
    .where(and(
      eq(landscapes.orgId, session.orgId),
      hasRole(session.role, 'admin')
        ? eq(landscapes.orgId, session.orgId)
        : eq(userLandscapeAccess.userId, session.userId),
    ))
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
  const session = await requireRole('editor');
  const body = await readJson(req, createLandscapeSchema);

  const landscapeSlug = slugify(body.name);
  if (!landscapeSlug) {
    throw new HttpError(422, 'That name has no usable characters for a URL.', 'invalid_name');
  }

  const [existingLandscape] = await db
    .select({ id: landscapes.id })
    .from(landscapes)
    .where(and(eq(landscapes.orgId, session.orgId), eq(landscapes.slug, landscapeSlug)))
    .limit(1);
  if (existingLandscape) {
    throw new HttpError(409, 'A landscape with that name already exists.', 'duplicate_landscape');
  }

  // Validate every existing company before creating a new pooled row. A bad
  // competitor id must not leave behind a company from an abandoned form.
  const memberIds = await assertCompaniesVisibleToUser(
    body.focusCompanyId ? [body.focusCompanyId, ...body.companyIds] : body.companyIds,
    session,
  );

  let focusCompanyId = body.focusCompanyId ?? null;
  let focusCompanyCreated = false;

  if (body.newFocusCompany) {
    const companySlug = slugify(body.newFocusCompany.name);
    if (!companySlug) {
      throw new HttpError(422, 'That company name has no usable characters for a URL.', 'invalid_name');
    }

    // Public companies are pooled. If another workspace already measures this
    // company, reusing the row gives the new landscape its existing history.
    const [pooled] = await db
      .select({ id: companies.id })
      .from(companies)
      .where(eq(companies.slug, companySlug))
      .limit(1);

    if (pooled) {
      focusCompanyId = pooled.id;
    } else {
      const [createdCompany] = await db
        .insert(companies)
        .values({
          orgId: session.orgId,
          name: body.newFocusCompany.name,
          slug: companySlug,
          website: body.newFocusCompany.website ?? null,
          logoUrl: body.newFocusCompany.logoUrl ?? null,
          segment: body.newFocusCompany.segment ?? null,
          color: body.newFocusCompany.color ?? null,
        })
        .onConflictDoNothing({ target: companies.slug })
        .returning({ id: companies.id });
      if (createdCompany) {
        focusCompanyId = createdCompany.id;
        focusCompanyCreated = true;
      } else {
        const [racedCompany] = await db
          .select({ id: companies.id })
          .from(companies)
          .where(eq(companies.slug, companySlug))
          .limit(1);
        if (!racedCompany) throw new Error('The pooled focus company could not be resolved.');
        focusCompanyId = racedCompany.id;
      }
    }
  }

  // The focus company is a member whether or not the caller listed it. A
  // landscape whose focus is not in its own set produces empty comparisons.
  const orderedMemberIds = focusCompanyId
    ? [focusCompanyId, ...memberIds.filter((id) => id !== focusCompanyId)]
    : memberIds;

  const [created] = await db
    .insert(landscapes)
    .values({
      orgId: session.orgId,
      name: body.name,
      slug: landscapeSlug,
      description: body.description ?? null,
      focusCompanyId,
    })
    .returning();

  if (orderedMemberIds.length > 0) {
    await db.insert(landscapeCompanies).values(
      orderedMemberIds.map((companyId, i) => ({
        landscapeId: created.id,
        companyId,
        sortOrder: i,
      })),
    );
  }

  // Restricted users must retain access to the landscape they just created.
  // Admins and owners are universal and do not need redundant grant rows.
  if (!hasRole(session.role, 'admin')) {
    await db.insert(userLandscapeAccess).values({
      userId: session.userId,
      landscapeId: created.id,
      grantedBy: session.userId,
    });
  }

  let collectionQueued = 0;
  try {
    const until = new Date();
    const { enqueueLandscapeCollection } = await import('@/lib/adapters/collection-queue');
    const collection = await enqueueLandscapeCollection({
      orgId: session.orgId,
      landscapeId: created.id,
      since: new Date(until.getTime() - 90 * 86_400_000),
      until,
    });
    collectionQueued = collection.queued;
  } catch (error) {
    // The landscape is already committed. Collection reconciliation is
    // idempotent and the next refresh/dispatcher will repair this safely.
    console.error('[data-dumpster:landscape] initial collection enqueue failed', error);
  }

  return Response.json(
    {
      ...created,
      companyIds: orderedMemberIds,
      focusCompanyCreated,
      collectionQueued,
    },
    { status: 201 },
  );
});
