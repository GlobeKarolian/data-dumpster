/**
 * /api/groups — register and remove watched public Facebook groups.
 *
 * Editors add a group by its public URL; the collector picks it up on the next
 * tick. A private URL is not rejected here (we cannot always tell from the URL)
 * but settles `ineligible` on first collection, which the UI shows.
 */
import type { NextRequest } from 'next/server';
import { z } from 'zod';
import { and, eq } from 'drizzle-orm';
import { apiHandler, requireOrg } from '@/lib/session';
import { db } from '@/db';
import { watchedGroups } from '@/db/schema';
import { roleAtLeast } from '@/lib/roles';

export const runtime = 'nodejs';

const AddSchema = z.object({
  url: z.string().url().refine(
    (u) => /facebook\.com\/groups\//i.test(u),
    'Must be a public Facebook group URL, e.g. https://www.facebook.com/groups/…',
  ),
  name: z.string().min(1).max(120),
  area: z.string().max(80).optional(),
});

export const POST = apiHandler(async (req: NextRequest) => {
  const { orgId, role } = await requireOrg();
  if (!roleAtLeast(role, 'editor')) {
    return Response.json({ error: 'Editors and admins can add groups.' }, { status: 403 });
  }
  const body = AddSchema.parse(await req.json());
  const [row] = await db.insert(watchedGroups)
    .values({ orgId, url: body.url, name: body.name, area: body.area ?? null })
    .onConflictDoNothing()
    .returning({ id: watchedGroups.id });
  return Response.json({ id: row?.id ?? null }, { status: row ? 201 : 200 });
});

const DeleteSchema = z.object({ id: z.string().uuid() });

export const DELETE = apiHandler(async (req: NextRequest) => {
  const { orgId, role } = await requireOrg();
  if (!roleAtLeast(role, 'editor')) {
    return Response.json({ error: 'Editors and admins can remove groups.' }, { status: 403 });
  }
  const { id } = DeleteSchema.parse(await req.json());
  await db.delete(watchedGroups)
    .where(and(eq(watchedGroups.id, id), eq(watchedGroups.orgId, orgId)));
  return Response.json({ ok: true });
});
