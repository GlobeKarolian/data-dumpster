/**
 * /api/report-documents -- reports built from ordered blocks.
 *
 * GET  list, newest first, with share status (but never the token itself).
 * POST create.
 *
 * The block vocabulary lives in lib/blocks/definitions.ts; the API validates
 * only the envelope (each block is an object with a type) for the same reason
 * the dashboard API does — so a new block type never needs a coordinated
 * deploy of the validation layer and the renderer.
 *
 * The share token is withheld from list responses on purpose: it is a bearer
 * credential for the published report's contents.
 */
import { z } from 'zod';
import { and, desc, eq } from 'drizzle-orm';
import type { NextRequest } from 'next/server';
import {
  apiHandler,
  assertLandscapeAccessible,
  requireOrg,
  requireRole,
  HttpError,
} from '@/lib/session';
import { db } from '@/db';
import { reportDocuments } from '@/db/schema';
import { slugify } from '@/lib/utils';
import { readJson } from '../_lib/query';
import { widgetsSchema } from '../_lib/widget';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const createSchema = z.object({
  name: z.string().trim().min(1).max(140),
  landscapeId: z.uuid().nullish(),
  blocks: widgetsSchema.default([]),
});

export const GET = apiHandler(async () => {
  const session = await requireOrg();

  const rows = await db
    .select({
      id: reportDocuments.id,
      name: reportDocuments.name,
      slug: reportDocuments.slug,
      landscapeId: reportDocuments.landscapeId,
      blocks: reportDocuments.blocks,
      status: reportDocuments.status,
      isShared: reportDocuments.shareToken,
      createdAt: reportDocuments.createdAt,
      updatedAt: reportDocuments.updatedAt,
    })
    .from(reportDocuments)
    .where(eq(reportDocuments.orgId, session.orgId))
    .orderBy(desc(reportDocuments.updatedAt));

  return Response.json(
    { items: rows.map(({ isShared, ...d }) => ({ ...d, isShared: isShared !== null })) },
    { headers: { 'cache-control': 'private, no-store' } },
  );
});

export const POST = apiHandler(async (req: NextRequest) => {
  const session = await requireRole('editor');
  const body = await readJson(req, createSchema);

  if (body.landscapeId) await assertLandscapeAccessible(body.landscapeId, session);

  const slug = slugify(body.name);
  if (!slug) throw new HttpError(422, 'That name has no usable characters for a URL.', 'invalid_name');

  const [existing] = await db
    .select({ id: reportDocuments.id })
    .from(reportDocuments)
    .where(and(eq(reportDocuments.orgId, session.orgId), eq(reportDocuments.slug, slug)))
    .limit(1);
  if (existing) throw new HttpError(409, 'A report with that name already exists.', 'duplicate_report');

  const [created] = await db
    .insert(reportDocuments)
    .values({
      orgId: session.orgId,
      name: body.name,
      slug,
      landscapeId: body.landscapeId ?? null,
      blocks: body.blocks,
      createdBy: session.userId,
    })
    .returning();

  const { shareToken, ...safe } = created;
  return Response.json({ ...safe, isShared: shareToken !== null }, { status: 201 });
});
