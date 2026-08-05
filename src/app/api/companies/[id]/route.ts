/**
 * /api/companies/[id]
 *
 * PATCH  edit display metadata. The slug is left alone on rename because it is
 *        part of URLs people have already bookmarked and shared; a name is a
 *        label, a slug is an address.
 * DELETE is disabled. Companies and their public history are pooled; remove
 *        landscape membership instead so a later re-add can reuse that history.
 */
import { z } from 'zod';
import { and, eq } from 'drizzle-orm';
import { apiHandler, requireRole, AuthError, HttpError } from '@/lib/session';
import { db } from '@/db';
import { companies } from '@/db/schema';
import { readJson } from '../../_lib/query';
import { assertCompanyNotSharedWithOtherOrgs } from '../../_lib/org-scope';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const idSchema = z.uuid('That is not a company id.');

const updateCompanySchema = z.object({
  name: z.string().trim().min(1).max(160).optional(),
  website: z.url().max(500).nullish(),
  logoUrl: z.url().max(500).nullish(),
  segment: z.string().trim().max(80).nullish(),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/, 'Use a six-digit hex color.').nullish(),
}).refine((b) => Object.keys(b).length > 0, 'Nothing to update.');

export const PATCH = apiHandler<{ id: string }>(async (req, ctx) => {
  const { orgId } = await requireRole('editor');
  const id = idSchema.parse((await ctx.params).id);
  const body = await readJson(req, updateCompanySchema);
  await assertCompanyNotSharedWithOtherOrgs(id, orgId);

  const [updated] = await db
    .update(companies)
    .set({
      ...(body.name !== undefined ? { name: body.name } : {}),
      ...(body.website !== undefined ? { website: body.website ?? null } : {}),
      ...(body.logoUrl !== undefined ? { logoUrl: body.logoUrl ?? null } : {}),
      ...(body.segment !== undefined ? { segment: body.segment ?? null } : {}),
      ...(body.color !== undefined ? { color: body.color ?? null } : {}),
    })
    .where(and(eq(companies.id, id), eq(companies.orgId, orgId)))
    .returning();

  if (!updated) throw new AuthError('not_found', 'That company does not exist.');
  return Response.json(updated);
});

export const DELETE = apiHandler(async () => {
  await requireRole('admin');
  throw new HttpError(
    405,
    'Pooled companies and their public history cannot be deleted. Remove the company from its '
      + 'landscapes instead.',
    'pooled_company_delete_disabled',
  );
});
