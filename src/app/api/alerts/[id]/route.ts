/**
 * /api/alerts/[id]
 *
 * PATCH  edit a rule, including the common case of just toggling "enabled".
 * DELETE remove it, and by cascade its event history.
 */
import { z } from 'zod';
import { and, eq } from 'drizzle-orm';
import { apiHandler, assertLandscapeInOrg, requireRole, AuthError } from '@/lib/session';
import { db } from '@/db';
import { alertRules } from '@/db/schema';
import { readJson } from '../../_lib/query';
import { alertConfigSchema, destinationsSchema } from '../../_lib/alert-config';
import { ALERT_KINDS } from '../_kinds';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const idSchema = z.uuid('That is not an alert id.');

const updateAlertSchema = z.object({
  name: z.string().trim().min(1).max(140).optional(),
  kind: z.enum(ALERT_KINDS).optional(),
  landscapeId: z.uuid().nullish(),
  config: alertConfigSchema.optional(),
  destinations: destinationsSchema.optional(),
  enabled: z.boolean().optional(),
}).refine((b) => Object.keys(b).length > 0, 'Nothing to update.');

export const PATCH = apiHandler<{ id: string }>(async (req, ctx) => {
  const { orgId } = await requireRole('editor');
  const id = idSchema.parse((await ctx.params).id);
  const body = await readJson(req, updateAlertSchema);

  if (body.landscapeId) await assertLandscapeInOrg(body.landscapeId, orgId);

  const [updated] = await db
    .update(alertRules)
    .set({
      ...(body.name !== undefined ? { name: body.name } : {}),
      ...(body.kind !== undefined ? { kind: body.kind } : {}),
      ...(body.landscapeId !== undefined ? { landscapeId: body.landscapeId ?? null } : {}),
      ...(body.config !== undefined ? { config: body.config } : {}),
      ...(body.destinations !== undefined ? { destinations: body.destinations } : {}),
      ...(body.enabled !== undefined ? { enabled: body.enabled } : {}),
    })
    .where(and(eq(alertRules.id, id), eq(alertRules.orgId, orgId)))
    .returning();

  if (!updated) throw new AuthError('not_found', 'That alert does not exist.');
  // Same rule as the collection endpoint: the webhook URL never comes back out.
  // Toggling `enabled` must not hand the caller a credential it did not send.
  return Response.json({
    ...updated,
    destinations: updated.destinations.map((d) => ({ type: d.type })),
  });
});

export const DELETE = apiHandler<{ id: string }>(async (_req, ctx) => {
  const { orgId } = await requireRole('editor');
  const id = idSchema.parse((await ctx.params).id);

  const [deleted] = await db
    .delete(alertRules)
    .where(and(eq(alertRules.id, id), eq(alertRules.orgId, orgId)))
    .returning({ id: alertRules.id });

  if (!deleted) throw new AuthError('not_found', 'That alert does not exist.');
  return new Response(null, { status: 204 });
});
