/**
 * /api/alerts -- standing questions about the landscape, answered on a schedule.
 *
 * GET  every rule in the org, with its most recent event.
 * POST create a rule.
 *
 * Webhook URLs are returned to the client because an editor has to be able to
 * see which channel a rule posts to; they are org-scoped and only visible to
 * signed-in members of that org.
 */
import { z } from 'zod';
import { desc, eq, sql } from 'drizzle-orm';
import type { NextRequest } from 'next/server';
import { apiHandler, assertLandscapeInOrg, requireOrg, requireRole } from '@/lib/session';
import { db } from '@/db';
import { alertEvents, alertRules } from '@/db/schema';
import { readJson } from '../_lib/query';
import { alertConfigSchema, destinationsSchema } from '../_lib/alert-config';
import { ALERT_KINDS } from './_kinds';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const createAlertSchema = z.object({
  name: z.string().trim().min(1).max(140),
  kind: z.enum(ALERT_KINDS),
  landscapeId: z.uuid().nullish(),
  config: alertConfigSchema.prefault({}),
  destinations: destinationsSchema.default([]),
  enabled: z.boolean().default(true),
});

export const GET = apiHandler(async () => {
  const { orgId } = await requireOrg();

  const rows = await db
    .select({
      id: alertRules.id,
      name: alertRules.name,
      kind: alertRules.kind,
      landscapeId: alertRules.landscapeId,
      config: alertRules.config,
      destinations: alertRules.destinations,
      enabled: alertRules.enabled,
      lastFiredAt: alertRules.lastFiredAt,
      createdAt: alertRules.createdAt,
      eventCount: sql<number>`count(${alertEvents.id})::int`,
      lastEventAt: sql<Date | null>`max(${alertEvents.createdAt})`,
    })
    .from(alertRules)
    .leftJoin(alertEvents, eq(alertEvents.ruleId, alertRules.id))
    .where(eq(alertRules.orgId, orgId))
    .groupBy(alertRules.id)
    .orderBy(desc(alertRules.createdAt));

  /**
   * Destinations are projected down to their kind before they leave the server.
   * A Slack incoming-webhook URL is a bearer credential: whoever holds it can
   * post into the newsroom's channel as Data Dumpster. This endpoint is readable by
   * any signed-in member including a viewer, and the UI only ever branches on
   * `type`, so the URL has no reason to be in the response at all.
   */
  const items = rows.map((r) => ({
    ...r,
    destinations: r.destinations.map((d) => ({ type: d.type })),
  }));

  return Response.json({ items }, { headers: { 'cache-control': 'private, no-store' } });
});

export const POST = apiHandler(async (req: NextRequest) => {
  const { orgId } = await requireRole('editor');
  const body = await readJson(req, createAlertSchema);

  if (body.landscapeId) await assertLandscapeInOrg(body.landscapeId, orgId);

  const [created] = await db
    .insert(alertRules)
    .values({
      orgId,
      name: body.name,
      kind: body.kind,
      landscapeId: body.landscapeId ?? null,
      config: body.config,
      destinations: body.destinations,
      enabled: body.enabled,
    })
    .returning();

  return Response.json(created, { status: 201 });
});
