/**
 * /api/cron/brief -- write last week's competitive brief for every landscape
 * that is subscribed to one.
 *
 * Runs Monday morning so the brief is waiting before the first news meeting.
 *
 * Two things are deliberate here:
 *
 *   - The window is the previous *calendar* week, Monday through Sunday, not
 *     "the last seven days". A brief that compares a Mon-Sun week to the Mon-Sun
 *     week before it is something an editor can reason about; a rolling window
 *     silently mixes weekday and weekend volume and makes every comparison
 *     slightly dishonest.
 *   - It is idempotent. A brief already written for a landscape and period is
 *     skipped, so a retried cron invocation costs nothing and cannot produce two
 *     contradictory documents for the same week.
 *
 * Generation itself is lib/ai/brief.ts, which computes a fact sheet in SQL, lets
 * the model narrate only what is in it, and verifies the prose against it before
 * saving. Nothing here invents a number.
 */
import { and, eq } from 'drizzle-orm';
import { endOfWeek, startOfWeek, subWeeks } from 'date-fns';
import type { NextRequest } from 'next/server';
import { apiHandler } from '@/lib/session';
import { db } from '@/db';
import { briefs, landscapes, modelConnections, orgs } from '@/db/schema';
import { generateBrief } from '@/lib/ai/brief';
import { toDayString } from '@/lib/dates';
import { assertCronAuthorized, cronJson } from '../../_lib/cron';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
/** Model calls plus a verification pass plus a possible repair turn. */
export const maxDuration = 300;

/**
 * Per-org brief settings, read from orgs.settings.
 *
 *   { "weeklyBrief": { "enabled": true, "landscapeIds": ["..."] } }
 *
 * Absent settings mean "every landscape", provided the org has actually
 * connected a model. Defaulting to on is the right call for a tool whose whole
 * pitch is that the newsroom owns its inference: an org that configured a model
 * has already made the expensive decision.
 */
interface WeeklyBriefSettings {
  enabled: boolean;
  landscapeIds: string[] | null;
}

function readSettings(raw: Record<string, unknown> | null): WeeklyBriefSettings {
  const value = raw?.weeklyBrief;
  if (typeof value !== 'object' || value === null) return { enabled: true, landscapeIds: null };
  const obj = value as { enabled?: unknown; landscapeIds?: unknown };
  return {
    enabled: obj.enabled !== false,
    landscapeIds: Array.isArray(obj.landscapeIds)
      ? obj.landscapeIds.filter((v): v is string => typeof v === 'string')
      : null,
  };
}

/** Monday 00:00 to Sunday 23:59 of the week that just ended. */
function lastCompleteWeek(now = new Date()): { start: Date; end: Date } {
  const thisWeek = startOfWeek(now, { weekStartsOn: 1 });
  const start = subWeeks(thisWeek, 1);
  return { start, end: endOfWeek(start, { weekStartsOn: 1 }) };
}

async function handle(req: NextRequest): Promise<Response> {
  assertCronAuthorized(req);

  const range = lastCompleteWeek();
  const periodStart = toDayString(range.start);
  const periodEnd = toDayString(range.end);

  const rows = await db
    .select({
      orgId: orgs.id,
      settings: orgs.settings,
      landscapeId: landscapes.id,
      landscapeName: landscapes.name,
    })
    .from(orgs)
    .innerJoin(landscapes, eq(landscapes.orgId, orgs.id));

  const summary = {
    period: { start: periodStart, end: periodEnd },
    considered: rows.length,
    generated: 0,
    skipped: 0,
    failed: 0,
    landscapes: [] as { landscapeId: string; status: string; briefId?: string | null }[],
  };

  // Orgs with no model connection cannot generate anything; checked once rather
  // than once per landscape.
  const connected = new Set(
    (await db
      .select({ orgId: modelConnections.orgId })
      .from(modelConnections)
      .where(eq(modelConnections.enabled, true))
    ).map((r) => r.orgId),
  );

  for (const row of rows) {
    const settings = readSettings(row.settings);
    const subscribed = settings.enabled
      && (settings.landscapeIds === null || settings.landscapeIds.includes(row.landscapeId));

    if (!subscribed || !connected.has(row.orgId)) {
      summary.skipped += 1;
      summary.landscapes.push({
        landscapeId: row.landscapeId,
        status: subscribed ? 'no_model_connection' : 'not_subscribed',
      });
      continue;
    }

    const [existing] = await db
      .select({ id: briefs.id })
      .from(briefs)
      .where(and(
        eq(briefs.landscapeId, row.landscapeId),
        eq(briefs.periodStart, periodStart),
        eq(briefs.periodEnd, periodEnd),
      ))
      .limit(1);

    if (existing) {
      summary.skipped += 1;
      summary.landscapes.push({ landscapeId: row.landscapeId, status: 'already_written', briefId: existing.id });
      continue;
    }

    try {
      const brief = await generateBrief(row.orgId, row.landscapeId, range, { persist: true });
      summary.generated += 1;
      summary.landscapes.push({
        landscapeId: row.landscapeId,
        status: brief.verification.ok ? 'generated' : 'generated_with_warnings',
        briefId: brief.id,
      });
    } catch (err) {
      summary.failed += 1;
      summary.landscapes.push({ landscapeId: row.landscapeId, status: 'failed' });
      console.error('[pressbox:cron/brief] landscape ' + row.landscapeId + ' failed', err);
    }
  }

  return cronJson({ ok: true, ...summary });
}

export const GET = apiHandler(handle);
export const POST = apiHandler(handle);
