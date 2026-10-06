/** PATCH: change a bio link's title, URL, schedule or pin. DELETE: remove it. */
import type { NextRequest } from 'next/server';
import { sql } from 'drizzle-orm';
import { z } from 'zod';
import { apiHandler, HttpError } from '@/lib/session';
import { requirePublishingUser } from '@/lib/publishing/guard';
import { q } from '@/lib/publishing/store';
import { NO_STORE } from '../../../_shared';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const patch = z.object({
  title: z.string().trim().min(1).max(200),
  url: z.string().url().max(2000),
  startsAt: z.string().datetime(),
  endsAt: z.string().datetime().nullable(),
  pinned: z.boolean(),
});

export const PATCH = apiHandler<{ id: string }>(async (req: NextRequest, ctx) => {
  const s = await requirePublishingUser();
  const id = z.string().uuid().parse((await ctx.params).id);
  const p = patch.parse(await req.json());
  const rows = await q<{ id: string }>(sql`UPDATE publish_bio_links SET title = ${p.title}, url = ${p.url},
      starts_at = ${p.startsAt}::timestamptz, ends_at = ${p.endsAt}::timestamptz, pinned = ${p.pinned}
    WHERE org_id = ${s.orgId}::uuid AND id = ${id}::uuid RETURNING id`);
  if (!rows.length) throw new HttpError(404, 'Link not found.', 'not_found');
  return Response.json({ ok: true }, NO_STORE);
});

export const DELETE = apiHandler<{ id: string }>(async (_req: NextRequest, ctx) => {
  const s = await requirePublishingUser();
  const id = z.string().uuid().parse((await ctx.params).id);
  await q(sql`DELETE FROM publish_bio_links WHERE org_id = ${s.orgId}::uuid AND id = ${id}::uuid`);
  return Response.json({ ok: true }, NO_STORE);
});
