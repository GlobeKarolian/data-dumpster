/**
 * /api/settings/operations -- the operator's control panel wire.
 *
 * GET returns every control (stored value overlaid on the code default) plus
 * a live status block, because a dial without a gauge invites blind twisting:
 * queue depth, today's vendor spend, today's comment purchases.
 *
 * PATCH writes one control. Owner-only: these dials move real money and real
 * crawls for every workspace, which is exactly what the owner role is for.
 */
import { z } from 'zod';
import type { NextRequest } from 'next/server';
import { sql } from 'drizzle-orm';
import { db } from '@/db';
import { apiHandler, requireRole } from '@/lib/session';
import {
  controlSchemas,
  readAllControls,
  writeControl,
  type ControlKey,
} from '@/lib/controls';
import { readJson } from '../../_lib/query';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const patchSchema = z.object({
  key: z.enum(Object.keys(controlSchemas) as [ControlKey, ...ControlKey[]]),
  value: z.unknown(),
});

async function status() {
  const [queue, spend, comments, summaries] = await Promise.all([
    db.execute<{ platform: string; pending: string | number; blocked: string | number }>(sql`
      SELECT c.platform,
             count(*) FILTER (
               WHERE s.status IN ('queued', 'running', 'partial')
                  OR (s.status = 'failed' AND s.next_attempt_at IS NOT NULL)
             ) AS pending,
             count(*) FILTER (
               WHERE s.status = 'failed' AND s.next_attempt_at IS NULL
             ) AS blocked
        FROM channel_collection_state s
        JOIN channels c ON c.id = s.channel_id
       GROUP BY 1 ORDER BY 2 DESC`),
    db.execute<{ vendor: string; records: string | number; cents: string | number }>(sql`
      SELECT vendor, sum(records) AS records, sum(estimated_cents) AS cents
        FROM vendor_spend
       WHERE created_at > date_trunc('day', now())
       GROUP BY 1`),
    db.execute<{ platform: string; comments: string | number }>(sql`
      SELECT c.platform, count(pc.id) AS comments
        FROM post_comments pc
        JOIN posts p ON p.id = pc.post_id
        JOIN channels c ON c.id = p.channel_id
       WHERE pc.collected_at > date_trunc('day', now())
       GROUP BY 1`),
    db.execute<{ written: string | number }>(sql`
      SELECT count(*) AS written
        FROM comment_summaries
       WHERE generated_at > date_trunc('day', now())`),
  ]);
  return {
    queueByPlatform: queue.rows.map((row) => ({
      platform: row.platform,
      pending: Number(row.pending) || 0,
      blocked: Number(row.blocked) || 0,
    })),
    spendToday: spend.rows.map((row) => ({
      vendor: row.vendor,
      records: Number(row.records) || 0,
      cents: Number(row.cents) || 0,
    })),
    commentsToday: comments.rows.map((row) => ({
      platform: row.platform,
      comments: Number(row.comments) || 0,
    })),
    summariesToday: Number(summaries.rows[0]?.written) || 0,
  };
}

async function handleGet(): Promise<Response> {
  await requireRole('owner');
  const [controls, live] = await Promise.all([readAllControls(), status()]);
  return Response.json({ controls, status: live });
}

async function handlePatch(req: NextRequest): Promise<Response> {
  const ctx = await requireRole('owner');
  const body = await readJson(req, patchSchema);
  const written = await writeControl(body.key, body.value, ctx.userId ?? null);
  return Response.json({ key: body.key, value: written });
}

export const GET = apiHandler(handleGet);
export const PATCH = apiHandler(handlePatch);
