/** PUT: replace a feed rule (admins). Re-activating does not re-post the backlog. */
import type { NextRequest } from 'next/server';
import { sql } from 'drizzle-orm';
import { z } from 'zod';
import { apiHandler, HttpError } from '@/lib/session';
import { requirePublishingApprover } from '@/lib/publishing/guard';
import { q } from '@/lib/publishing/store';
import { NO_STORE } from '../../_shared';
import { feedSchema } from '../schema';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const PUT = apiHandler<{ id: string }>(async (req: NextRequest, ctx) => {
  const s = await requirePublishingApprover();
  const id = z.string().uuid().parse((await ctx.params).id);
  const f = feedSchema.parse(await req.json());
  const rows = await q<{ id: string }>(sql`UPDATE publish_feeds SET label = ${f.label},
      -- A new URL, or switching a paused feed back on, starts fresh: the next poll
      -- records what is there instead of posting it.
      last_polled_at = CASE WHEN url = ${f.url} AND (active OR NOT ${f.active}) THEN last_polled_at ELSE NULL END,
      url = ${f.url}, target_ids = ${JSON.stringify(f.targetIds)}::jsonb, templates = ${JSON.stringify(f.templates)}::jsonb,
      include_categories = ${JSON.stringify(f.includeCategories)}::jsonb, exclude_keywords = ${JSON.stringify(f.excludeKeywords)}::jsonb,
      window_minutes = ${f.windowMinutes}, require_approval = ${f.requireApproval}, active = ${f.active}
    WHERE org_id = ${s.orgId}::uuid AND id = ${id}::uuid RETURNING id`);
  if (!rows.length) throw new HttpError(404, 'Feed not found.', 'not_found');
  return Response.json({ ok: true }, NO_STORE);
});
