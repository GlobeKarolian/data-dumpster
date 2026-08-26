/**
 * /api/landscapes/[id]
 *
 * GET    one landscape with its members, in display order.
 * PATCH  rename, re-describe, change the focus company, or replace membership.
 * DELETE remove it. Posts and companies survive; only the grouping goes.
 *
 * assertLandscapeAccessible is called before user-facing reads and edits. It
 * is the place a client-supplied landscape id becomes trustworthy.
 */
import { z } from 'zod';
import { and, asc, eq } from 'drizzle-orm';
import {
  apiHandler,
  assertLandscapeAccessible,
  requireOrg,
  requireRole,
  AuthError,
  HttpError,
} from '@/lib/session';
import { db } from '@/db';
import { companies, landscapeCompanies, landscapes } from '@/db/schema';
import { slugify } from '@/lib/utils';
import { LANDSCAPE_IMPORT_MAX_COMPANIES } from '@/lib/landscape-import';
import { replaceLandscapeMembership } from '@/lib/landscape-membership';
import { readJson } from '../../_lib/query';
import { assertCompaniesVisibleToUser } from '../../_lib/org-scope';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const idSchema = z.uuid('That is not a landscape id.');

const updateLandscapeSchema = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  description: z.string().trim().max(2000).nullish(),
  focusCompanyId: z.uuid().nullish(),
  /** When present, replaces membership wholesale. Omit to leave members alone. */
  companyIds: z.array(z.uuid()).max(LANDSCAPE_IMPORT_MAX_COMPANIES).optional(),
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
  const session = await requireOrg();
  const id = idSchema.parse((await ctx.params).id);
  const landscape = await assertLandscapeAccessible(id, session);

  const [full] = await db
    .select()
    .from(landscapes)
    .where(and(eq(landscapes.id, landscape.id), eq(landscapes.orgId, session.orgId)))
    .limit(1);

  return Response.json(
    { ...full, companies: await membersOf(landscape.id) },
    { headers: { 'cache-control': 'private, no-store' } },
  );
});

export const PATCH = apiHandler<{ id: string }>(async (req, ctx) => {
  const session = await requireRole('editor');
  const id = idSchema.parse((await ctx.params).id);
  await assertLandscapeAccessible(id, session);
  const body = await readJson(req, updateLandscapeSchema);

  let slug: string | undefined;
  if (body.name !== undefined) {
    slug = slugify(body.name);
    if (!slug) throw new HttpError(422, 'That name has no usable characters for a URL.', 'invalid_name');
  }

  if (body.focusCompanyId) await assertCompaniesVisibleToUser([body.focusCompanyId], session);

  const [updated] = await db
    .update(landscapes)
    .set({
      ...(body.name !== undefined ? { name: body.name, slug } : {}),
      ...(body.description !== undefined ? { description: body.description ?? null } : {}),
      ...(body.focusCompanyId !== undefined ? { focusCompanyId: body.focusCompanyId ?? null } : {}),
    })
    .where(and(eq(landscapes.id, id), eq(landscapes.orgId, session.orgId)))
    .returning();
  if (!updated) throw new AuthError('not_found', 'That landscape does not exist.');

  if (body.companyIds !== undefined) {
    const memberIds = await assertCompaniesVisibleToUser(
      updated.focusCompanyId ? [updated.focusCompanyId, ...body.companyIds] : body.companyIds,
      session,
    );
    await replaceLandscapeMembership(id, memberIds);

    try {
      const until = new Date();
      const { enqueueLandscapeCollection } = await import('@/lib/adapters/collection-queue');
      await enqueueLandscapeCollection({
        orgId: session.orgId,
        landscapeId: id,
        since: new Date(until.getTime() - 90 * 86_400_000),
        until,
      });
    } catch (error) {
      // Membership is already committed. Demand writes are idempotent, so a
      // later refresh can finish without rolling back the user's edit.
      console.error('[data-dumpster:landscape] membership collection enqueue failed', error);
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
