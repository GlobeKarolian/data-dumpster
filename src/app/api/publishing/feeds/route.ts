/** GET: RSS autopublish rules. POST: add one (admins). */
import type { NextRequest } from 'next/server';
import { sql } from 'drizzle-orm';
import { apiHandler } from '@/lib/session';
import { requirePublishingApprover, requirePublishingUser } from '@/lib/publishing/guard';
import { listFeeds, q } from '@/lib/publishing/store';
import { NO_STORE } from '../_shared';
import { feedSchema } from './schema';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const GET = apiHandler(async () => {
  const s = await requirePublishingUser();
  return Response.json({ feeds: await listFeeds(s.orgId) }, NO_STORE);
});

export const POST = apiHandler(async (req: NextRequest) => {
  const s = await requirePublishingApprover();
  const f = feedSchema.parse(await req.json());
  const [{ id }] = await q<{ id: string }>(sql`INSERT INTO publish_feeds
      (org_id, label, url, target_ids, templates, include_categories, exclude_keywords, window_minutes, require_approval, active)
    VALUES (${s.orgId}::uuid, ${f.label}, ${f.url}, ${JSON.stringify(f.targetIds)}::jsonb, ${JSON.stringify(f.templates)}::jsonb,
            ${JSON.stringify(f.includeCategories)}::jsonb, ${JSON.stringify(f.excludeKeywords)}::jsonb, ${f.windowMinutes}, ${f.requireApproval}, ${f.active})
    RETURNING id`);
  return Response.json({ id }, { status: 201, ...NO_STORE });
});
