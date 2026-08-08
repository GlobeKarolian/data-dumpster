/**
 * /api/dashboards/[id]
 *
 * GET    the dashboard, including its widget definitions.
 * PATCH  rename, repoint at another landscape, or replace the widget layout.
 * DELETE remove it. Deleting also revokes any share link, because the row and
 *        the token die together -- there is no orphaned public URL left behind.
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
import { dashboards } from '@/db/schema';
import { slugify } from '@/lib/utils';
import { readJson } from '../../_lib/query';
import { widgetsSchema } from '../../_lib/widget';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const idSchema = z.uuid('That is not a dashboard id.');

const updateDashboardSchema = z.object({
  name: z.string().trim().min(1).max(140).optional(),
  landscapeId: z.uuid().nullish(),
  widgets: widgetsSchema.optional(),
}).refine((b) => Object.keys(b).length > 0, 'Nothing to update.');

export const GET = apiHandler<{ id: string }>(async (_req, ctx) => {
  const session = await requireOrg();
  const id = idSchema.parse((await ctx.params).id);

  const [row] = await db
    .select()
    .from(dashboards)
    .where(and(eq(dashboards.id, id), eq(dashboards.orgId, session.orgId)))
    .limit(1);
  if (!row) throw new AuthError('not_found', 'That dashboard does not exist.');
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
  const body = await readJson(req, updateDashboardSchema);

  const [existing] = await db
    .select({ landscapeId: dashboards.landscapeId })
    .from(dashboards)
    .where(and(eq(dashboards.id, id), eq(dashboards.orgId, session.orgId)))
    .limit(1);
  if (!existing) throw new AuthError('not_found', 'That dashboard does not exist.');
  if (existing.landscapeId) await assertLandscapeAccessible(existing.landscapeId, session);
  if (body.landscapeId) await assertLandscapeAccessible(body.landscapeId, session);

  let slug: string | undefined;
  if (body.name !== undefined) {
    slug = slugify(body.name);
    if (!slug) throw new HttpError(422, 'That name has no usable characters for a URL.', 'invalid_name');
  }

  const [updated] = await db
    .update(dashboards)
    .set({
      ...(body.name !== undefined ? { name: body.name, slug } : {}),
      ...(body.landscapeId !== undefined ? { landscapeId: body.landscapeId ?? null } : {}),
      ...(body.widgets !== undefined ? { widgets: body.widgets } : {}),
      updatedAt: new Date(),
    })
    .where(and(eq(dashboards.id, id), eq(dashboards.orgId, session.orgId)))
    .returning();

  if (!updated) throw new AuthError('not_found', 'That dashboard does not exist.');
  const { shareToken, ...safe } = updated;
  return Response.json({ ...safe, isShared: shareToken !== null });
});

export const DELETE = apiHandler<{ id: string }>(async (_req, ctx) => {
  const session = await requireRole('editor');
  const id = idSchema.parse((await ctx.params).id);

  const [existing] = await db
    .select({ landscapeId: dashboards.landscapeId })
    .from(dashboards)
    .where(and(eq(dashboards.id, id), eq(dashboards.orgId, session.orgId)))
    .limit(1);
  if (!existing) throw new AuthError('not_found', 'That dashboard does not exist.');
  if (existing.landscapeId) await assertLandscapeAccessible(existing.landscapeId, session);

  const [deleted] = await db
    .delete(dashboards)
    .where(and(eq(dashboards.id, id), eq(dashboards.orgId, session.orgId)))
    .returning({ id: dashboards.id });

  if (!deleted) throw new AuthError('not_found', 'That dashboard does not exist.');
  return new Response(null, { status: 204 });
});
