/**
 * POST: add links to a bio page, one or many. Each link can be scheduled to go
 * live and to expire. Bulk import takes "Title | URL" lines, which is how the
 * current Later / Linktree lists move over.
 */
import type { NextRequest } from 'next/server';
import { sql } from 'drizzle-orm';
import { z } from 'zod';
import { apiHandler, HttpError } from '@/lib/session';
import { requirePublishingUser } from '@/lib/publishing/guard';
import { q } from '@/lib/publishing/store';
import { NO_STORE } from '../../_shared';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const link = z.object({
  title: z.string().trim().min(1).max(200),
  url: z.string().url().max(2000),
  imageUrl: z.string().url().startsWith('https://').nullable().default(null),
  startsAt: z.string().datetime().nullable().default(null),
  endsAt: z.string().datetime().nullable().default(null),
  pinned: z.boolean().default(false),
});
const body = z.object({ pageId: z.string().uuid(), links: z.array(link).min(1).max(200) });

export const POST = apiHandler(async (req: NextRequest) => {
  const s = await requirePublishingUser();
  const b = body.parse(await req.json());
  const page = await q<{ id: string }>(sql`SELECT id FROM publish_bio_pages WHERE org_id = ${s.orgId}::uuid AND id = ${b.pageId}::uuid`);
  if (!page.length) throw new HttpError(404, 'Page not found.', 'not_found');
  // Imported lists arrive top-first; stagger by a second so the order survives "newest first".
  const base = Date.now();
  for (const [i, l] of b.links.entries()) {
    const starts = l.startsAt ?? new Date(base - i * 1000).toISOString();
    await q(sql`INSERT INTO publish_bio_links (org_id, page_id, title, url, image_url, starts_at, ends_at, pinned)
      VALUES (${s.orgId}::uuid, ${b.pageId}::uuid, ${l.title}, ${l.url}, ${l.imageUrl}, ${starts}::timestamptz,
              ${l.endsAt}::timestamptz, ${l.pinned})`);
  }
  return Response.json({ added: b.links.length }, { status: 201, ...NO_STORE });
});
