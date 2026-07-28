/**
 * /api/dashboards -- saved arrangements of widgets over one landscape.
 *
 * GET  list, newest first, with share status (but never the token itself).
 * POST create.
 *
 * The share token is withheld from the list response on purpose. It is a bearer
 * credential for the dashboard's contents; it belongs in exactly two places, the
 * response to the mint call and the URL the user copies from it. Sprinkling it
 * through every list payload puts it in browser caches and server logs.
 */
import { z } from 'zod';
import { desc, eq, and } from 'drizzle-orm';
import type { NextRequest } from 'next/server';
import { apiHandler, assertLandscapeInOrg, requireOrg, requireRole, HttpError } from '@/lib/session';
import { db } from '@/db';
import { dashboards } from '@/db/schema';
import { slugify } from '@/lib/utils';
import { readJson } from '../_lib/query';
import { widgetsSchema } from '../_lib/widget';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const createDashboardSchema = z.object({
  name: z.string().trim().min(1).max(140),
  landscapeId: z.uuid().nullish(),
  widgets: widgetsSchema.default([]),
});

export const GET = apiHandler(async () => {
  const { orgId } = await requireOrg();

  const rows = await db
    .select({
      id: dashboards.id,
      name: dashboards.name,
      slug: dashboards.slug,
      landscapeId: dashboards.landscapeId,
      widgets: dashboards.widgets,
      isShared: dashboards.shareToken,
      createdAt: dashboards.createdAt,
      updatedAt: dashboards.updatedAt,
    })
    .from(dashboards)
    .where(eq(dashboards.orgId, orgId))
    .orderBy(desc(dashboards.updatedAt));

  return Response.json(
    { items: rows.map(({ isShared, ...d }) => ({ ...d, isShared: isShared !== null })) },
    { headers: { 'cache-control': 'private, no-store' } },
  );
});

export const POST = apiHandler(async (req: NextRequest) => {
  const { orgId } = await requireRole('editor');
  const body = await readJson(req, createDashboardSchema);

  if (body.landscapeId) await assertLandscapeInOrg(body.landscapeId, orgId);

  const slug = slugify(body.name);
  if (!slug) throw new HttpError(422, 'That name has no usable characters for a URL.', 'invalid_name');

  const [existing] = await db
    .select({ id: dashboards.id })
    .from(dashboards)
    .where(and(eq(dashboards.orgId, orgId), eq(dashboards.slug, slug)))
    .limit(1);
  if (existing) throw new HttpError(409, 'A dashboard with that name already exists.', 'duplicate_dashboard');

  const [created] = await db
    .insert(dashboards)
    .values({
      orgId,
      name: body.name,
      slug,
      landscapeId: body.landscapeId ?? null,
      widgets: body.widgets,
    })
    .returning();

  const { shareToken, ...safe } = created;
  return Response.json({ ...safe, isShared: shareToken !== null }, { status: 201 });
});
