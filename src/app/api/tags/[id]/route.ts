/**
 * /api/tags/[id]
 *
 * PATCH  rename, recolor, or change the rule.
 * DELETE remove the tag and, by cascade, every assignment of it.
 *
 * Every statement carries the org id in its WHERE clause. Fetching the row first
 * and then trusting it would leave a window where the tag moved orgs between the
 * check and the write; making the guard part of the write closes it, and a zero
 * row count is indistinguishable to the caller from "no such tag".
 */
import { z } from 'zod';
import { and, eq, sql } from 'drizzle-orm';
import { apiHandler, requireRole, AuthError, HttpError } from '@/lib/session';
import { db } from '@/db';
import { postTags } from '@/db/schema';
import { readJson } from '../../_lib/query';
import { colorSchema, tagRuleSchema } from '../../_lib/tag-rule';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const idSchema = z.uuid('That is not a tag id.');

const updateTagSchema = z.object({
  name: z.string().trim().min(1).max(80).optional(),
  color: colorSchema.nullish(),
  rule: tagRuleSchema.nullish(),
  aiPrompt: z.string().trim().min(1).max(2000).nullish(),
}).refine((b) => Object.keys(b).length > 0, 'Nothing to update.');

export const PATCH = apiHandler<{ id: string }>(async (req, ctx) => {
  const { orgId } = await requireRole('editor');
  const id = idSchema.parse((await ctx.params).id);
  const body = await readJson(req, updateTagSchema);

  if (body.name !== undefined) {
    const [clash] = await db
      .select({ id: postTags.id })
      .from(postTags)
      .where(and(
        eq(postTags.orgId, orgId),
        sql`lower(${postTags.name}) = lower(${body.name})`,
        sql`${postTags.id} <> ${id}`,
      ))
      .limit(1);
    if (clash) throw new HttpError(409, 'A tag with that name already exists.', 'duplicate_tag');
  }

  const [updated] = await db
    .update(postTags)
    .set({
      ...(body.name !== undefined ? { name: body.name } : {}),
      ...(body.color !== undefined ? { color: body.color ?? null } : {}),
      ...(body.rule !== undefined ? { rule: body.rule ?? null } : {}),
      ...(body.aiPrompt !== undefined ? { aiPrompt: body.aiPrompt ?? null } : {}),
    })
    .where(and(eq(postTags.id, id), eq(postTags.orgId, orgId)))
    .returning();

  if (!updated) throw new AuthError('not_found', 'That tag does not exist.');
  return Response.json(updated);
});

export const DELETE = apiHandler<{ id: string }>(async (_req, ctx) => {
  const { orgId } = await requireRole('editor');
  const id = idSchema.parse((await ctx.params).id);

  const [deleted] = await db
    .delete(postTags)
    .where(and(eq(postTags.id, id), eq(postTags.orgId, orgId)))
    .returning({ id: postTags.id });

  if (!deleted) throw new AuthError('not_found', 'That tag does not exist.');
  return new Response(null, { status: 204 });
});
