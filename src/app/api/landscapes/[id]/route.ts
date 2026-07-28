/**
 * /api/landscapes/[id]
 *
 * GET    one landscape with its members, in display order.
 * PATCH  rename, re-describe, change the focus company, or replace membership.
 * DELETE remove it. Posts and companies survive; only the grouping goes.
 *
 * assertLandscapeInOrg is called before anything else in every method. It is the
 * single place a client-supplied landscape id becomes trustworthy.
 */
import { z } from 'zod';
import { and, asc, eq } from 'drizzle-orm';
import { apiHandler, assertLandscapeInOrg, requireOrg, requireRole, AuthError, HttpError } from '@/lib/session';
import { db } from '@/db';
import { companies, landscapeCompanies, landscapes } from '@/db/schema';
import { slugify } from '@/lib/utils';
import { readJson } from '../../_lib/query';
import { assertCompaniesInOrg } from '../../_lib/org-scope';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const idSchema = z.uuid('That is not a landscape id.');

const updateLandscapeSchema = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  description: z.string().trim().max(2000).nullish(),
  focusCompanyId: z.uuid().nullish(),
  /** When present, replaces membership wholesale. Omit to leave members alone. */
  companyIds: z.array(z.uuid()).max(50).optional(),
}).refine((b) => Object.keys(b).length > 0, 'Nothing to update.');

async function membersOf(landscapeId: string) {
  return db
    .select({
      id: companies.id,
      name: companies.name,
      slug: companies.slug,
      color: companies.color,
      logoUrl: companies.logoUrl,
      segment: companies.segment,
      sortOrder: landscapeCompanies.sortOrder,
    })
    .from(landscapeCompanies)
    .innerJoin(companies, eq(companies.id, landscapeCompanies.companyId))
    .where(eq(landscapeCompanies.landscapeId, landscapeId))
    .orderBy(asc(landscapeCompanies.sortOrder), asc(companies.name));
}

export const GET = apiHandler<{ id: string }>(async (_req, ctx) => {
  const { orgId } = await requireOrg();
  const id = idSchema.parse((await ctx.params).id);
  const landscape = await assertLandscapeInOrg(id, orgId);

  const [full] = await db
    .select()
    .from(landscapes)
    .where(and(eq(landscapes.id, landscape.id), eq(landscapes.orgId, orgId)))
    .limit(1);

  return Response.json(
    { ...full, companies: await membersOf(landscape.id) },
    { headers: { 'cache-control': 'private, no-store' } },
  );
});

export const PATCH = apiHandler<{ id: string }>(async (req, ctx) => {
  const { orgId } = await requireRole('editor');
  const id = idSchema.parse((await ctx.params).id);
  await assertLandscapeInOrg(id, orgId);
  const body = await readJson(req, updateLandscapeSchema);

  let slug: string | undefined;
  if (body.name !== undefined) {
    slug = slugify(body.name);
    if (!slug) throw new HttpError(422, 'That name has no usable characters for a URL.', 'invalid_name');
  }

  if (body.focusCompanyId) await assertCompaniesInOrg([body.focusCompanyId], orgId);

  const [updated] = await db
    .update(landscapes)
    .set({
      ...(body.name !== undefined ? { name: body.name, slug } : {}),
      ...(body.description !== undefined ? { description: body.description ?? null } : {}),
      ...(body.focusCompanyId !== undefined ? { focusCompanyId: body.focusCompanyId ?? null } : {}),
    })
    .where(and(eq(landscapes.id, id), eq(landscapes.orgId, orgId)))
    .returning();
  if (!updated) throw new AuthError('not_found', 'That landscape does not exist.');

  if (body.companyIds !== undefined) {
    const memberIds = await assertCompaniesInOrg(
      updated.focusCompanyId ? [updated.focusCompanyId, ...body.companyIds] : body.companyIds,
      orgId,
    );
    // Replace rather than diff: membership is small, and a delete-then-insert is
    // one obvious statement pair instead of three fiddly ones.
    await db.delete(landscapeCompanies).where(eq(landscapeCompanies.landscapeId, id));
    if (memberIds.length > 0) {
      await db.insert(landscapeCompanies).values(
        memberIds.map((companyId, i) => ({ landscapeId: id, companyId, sortOrder: i })),
      );
    }
  }

  return Response.json({ ...updated, companies: await membersOf(id) });
});

export const DELETE = apiHandler<{ id: string }>(async (_req, ctx) => {
  const { orgId } = await requireRole('admin');
  const id = idSchema.parse((await ctx.params).id);

  const [deleted] = await db
    .delete(landscapes)
    .where(and(eq(landscapes.id, id), eq(landscapes.orgId, orgId)))
    .returning({ id: landscapes.id });

  if (!deleted) throw new AuthError('not_found', 'That landscape does not exist.');
  return new Response(null, { status: 204 });
});
