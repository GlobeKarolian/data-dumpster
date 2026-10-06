/**
 * Link in bio. GET: pages and their links. POST: create a page (admins).
 * Public pages render at /links/<slug>.
 */
import type { NextRequest } from 'next/server';
import { sql } from 'drizzle-orm';
import { z } from 'zod';
import { apiHandler, HttpError } from '@/lib/session';
import { requirePublishingApprover, requirePublishingUser } from '@/lib/publishing/guard';
import { listBioLinks, listBioPages, q } from '@/lib/publishing/store';
import { NO_STORE } from '../_shared';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const GET = apiHandler(async () => {
  const s = await requirePublishingUser();
  const pages = await listBioPages(s.orgId);
  const links = await Promise.all(pages.map((p) => listBioLinks(s.orgId, p.id)));
  return Response.json({ pages: pages.map((p, i) => ({ ...p, links: links[i] })) }, NO_STORE);
});

const pageSchema = z.object({
  slug: z.string().trim().toLowerCase().regex(/^[a-z0-9][a-z0-9-]{1,40}$/, 'Use lowercase letters, numbers and dashes.'),
  title: z.string().trim().min(1).max(120),
  brand: z.string().trim().min(1).max(80),
  avatarUrl: z.string().url().startsWith('https://').nullable().default(null),
});

export const POST = apiHandler(async (req: NextRequest) => {
  const s = await requirePublishingApprover();
  const p = pageSchema.parse(await req.json());
  const taken = await q<{ id: string }>(sql`SELECT id FROM publish_bio_pages WHERE slug = ${p.slug}`);
  if (taken.length) throw new HttpError(409, 'That address is already in use.', 'conflict');
  const [{ id }] = await q<{ id: string }>(sql`INSERT INTO publish_bio_pages (org_id, slug, title, brand, avatar_url)
    VALUES (${s.orgId}::uuid, ${p.slug}, ${p.title}, ${p.brand}, ${p.avatarUrl}) RETURNING id`);
  return Response.json({ id }, { status: 201, ...NO_STORE });
});
