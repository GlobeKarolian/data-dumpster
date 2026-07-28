/**
 * /api/tags -- the newsroom's own post taxonomy.
 *
 * GET  list every tag in the org, with how many posts currently carry it.
 * POST create a tag, optionally with an auto-tag rule or an AI prompt.
 *
 * Tags are org-scoped rather than landscape-scoped on purpose: "Breaking News"
 * means the same thing whichever competitive set you are looking at, and a
 * taxonomy that forks per landscape stops being comparable.
 */
import { z } from 'zod';
import { and, count, eq, sql } from 'drizzle-orm';
import type { NextRequest } from 'next/server';
import { apiHandler, requireOrg, requireRole, HttpError } from '@/lib/session';
import { db } from '@/db';
import { postTagAssignments, postTags } from '@/db/schema';
import { readJson } from '../_lib/query';
import { colorSchema, tagRuleSchema } from '../_lib/tag-rule';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const createTagSchema = z.object({
  name: z.string().trim().min(1).max(80),
  color: colorSchema.nullish(),
  rule: tagRuleSchema.nullish(),
  aiPrompt: z.string().trim().min(1).max(2000).nullish(),
});

export const GET = apiHandler(async () => {
  const { orgId } = await requireOrg();

  const rows = await db
    .select({
      id: postTags.id,
      name: postTags.name,
      color: postTags.color,
      rule: postTags.rule,
      aiPrompt: postTags.aiPrompt,
      createdAt: postTags.createdAt,
      postCount: count(postTagAssignments.postId),
    })
    .from(postTags)
    .leftJoin(postTagAssignments, eq(postTagAssignments.tagId, postTags.id))
    .where(eq(postTags.orgId, orgId))
    .groupBy(postTags.id)
    .orderBy(postTags.name);

  return Response.json({ items: rows }, { headers: { 'cache-control': 'private, no-store' } });
});

export const POST = apiHandler(async (req: NextRequest) => {
  const { orgId } = await requireRole('editor');
  const body = await readJson(req, createTagSchema);

  const [existing] = await db
    .select({ id: postTags.id })
    .from(postTags)
    .where(and(eq(postTags.orgId, orgId), sql`lower(${postTags.name}) = lower(${body.name})`))
    .limit(1);
  if (existing) throw new HttpError(409, 'A tag with that name already exists.', 'duplicate_tag');

  const [created] = await db
    .insert(postTags)
    .values({
      orgId,
      name: body.name,
      color: body.color ?? null,
      rule: body.rule ?? null,
      aiPrompt: body.aiPrompt ?? null,
    })
    .returning();

  return Response.json(created, { status: 201 });
});
