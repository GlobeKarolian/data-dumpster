/**
 * /api/report-documents/[id]
 *
 * GET    the report, including its block definitions.
 * PATCH  rename, repoint at another landscape, replace the block layout, or
 *        change status (draft/published).
 * DELETE remove it. Deleting also revokes any share link, because the row and
 *        the token die together.
 */
import { z } from 'zod';
import { and, eq } from 'drizzle-orm';
import {
  apiHandler,
  assertLandscapeAccessible,
  requireOrg,
  requireRole,
  AuthError,
  HttpError,
} from '@/lib/session';
import { db } from '@/db';
import { reportDocuments } from '@/db/schema';
import { slugify } from '@/lib/utils';
import { readJson } from '../../_lib/query';
import { widgetsSchema } from '../../_lib/widget';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const idSchema = z.uuid('That is not a report id.');

const updateSchema = z.object({
  name: z.string().trim().min(1).max(140).optional(),
  landscapeId: z.uuid().nullish(),
  blocks: widgetsSchema.optional(),
  status: z.enum(['draft', 'published']).optional(),
}).refine((b) => Object.keys(b).length > 0, 'Nothing to update.');

export const GET = apiHandler<{ id: string }>(async (_req, ctx) => {
  const session = await requireOrg();
  const id = idSchema.parse((await ctx.params).id);

  const [row] = await db
    .select()
    .from(reportDocuments)
    .where(and(eq(reportDocuments.id, id), eq(reportDocuments.orgId, session.orgId)))
    .limit(1);
  if (!row) throw new AuthError('not_found', 'That report does not exist.');
  if (row.landscapeId) await assertLandscapeAccessible(row.landscapeId, session);

  const { shareToken, ...safe } = row;
  return Response.json(
    { ...safe, isShared: shareToken !== null },
    { headers: { 'cache-control': 'private, no-store' } },
  );
});

export const PATCH = apiHandler<{ id: string }>(async (req, ctx) => {
  const session = await requireRole('editor');
  const id = idSchema.parse((await ctx.params).id);
  const body = await readJson(req, updateSchema);

  const [existing] = await db
    .select({ landscapeId: reportDocuments.landscapeId })
    .from(reportDocuments)
    .where(and(eq(reportDocuments.id, id), eq(reportDocuments.orgId, session.orgId)))
    .limit(1);
  if (!existing) throw new AuthError('not_found', 'That report does not exist.');
  if (existing.landscapeId) await assertLandscapeAccessible(existing.landscapeId, session);
  if (body.landscapeId) await assertLandscapeAccessible(body.landscapeId, session);

  let slug: string | undefined;
  if (body.name !== undefined) {
    slug = slugify(body.name);
    if (!slug) throw new HttpError(422, 'That name has no usable characters for a URL.', 'invalid_name');
  }

  const [updated] = await db
    .update(reportDocuments)
    .set({
      ...(body.name !== undefined ? { name: body.name, slug } : {}),
      ...(body.landscapeId !== undefined ? { landscapeId: body.landscapeId ?? null } : {}),
      ...(body.blocks !== undefined ? { blocks: body.blocks } : {}),
      ...(body.status !== undefined ? { status: body.status } : {}),
      updatedAt: new Date(),
    })
    .where(and(eq(reportDocuments.id, id), eq(reportDocuments.orgId, session.orgId)))
    .returning();

  if (!updated) throw new AuthError('not_found', 'That report does not exist.');
  const { shareToken, ...safe } = updated;
  return Response.json({ ...safe, isShared: shareToken !== null });
});

export const DELETE = apiHandler<{ id: string }>(async (_req, ctx) => {
  const session = await requireRole('editor');
  const id = idSchema.parse((await ctx.params).id);

  const [existing] = await db
    .select({ landscapeId: reportDocuments.landscapeId })
    .from(reportDocuments)
    .where(and(eq(reportDocuments.id, id), eq(reportDocuments.orgId, session.orgId)))
    .limit(1);
  if (!existing) throw new AuthError('not_found', 'That report does not exist.');
  if (existing.landscapeId) await assertLandscapeAccessible(existing.landscapeId, session);

  const [deleted] = await db
    .delete(reportDocuments)
    .where(and(eq(reportDocuments.id, id), eq(reportDocuments.orgId, session.orgId)))
    .returning({ id: reportDocuments.id });

  if (!deleted) throw new AuthError('not_found', 'That report does not exist.');
  return new Response(null, { status: 204 });
});
