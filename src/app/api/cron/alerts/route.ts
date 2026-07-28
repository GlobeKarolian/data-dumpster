/**
 * /api/cron/alerts -- evaluate every enabled rule and deliver what is new.
 *
 * Runs hourly. The two things that make it safe to run that often:
 *
 *   1. Deduplication. Every candidate finding carries a stable key, and a key
 *      that already produced an event inside the rule's lookback window is
 *      dropped. Otherwise an hourly job over a seven-day window would announce
 *      the same outlier 168 times.
 *   2. Delivery is best-effort and isolated. A Slack webhook that is 404ing
 *      because someone deleted the channel must not stop the next rule from
 *      being evaluated, and must not prevent the event from being recorded --
 *      the event is the record, Slack is a notification.
 */
import { and, eq, gte } from 'drizzle-orm';
import type { NextRequest } from 'next/server';
import { apiHandler } from '@/lib/session';
import { db } from '@/db';
import { alertEvents, alertRules } from '@/db/schema';
import { presetRange } from '@/lib/dates';
import { assertCronAuthorized, cronJson } from '../../_lib/cron';
import {
  readStoredConfig, readStoredDestinations, type AlertDestination,
} from '../../_lib/alert-config';
import { evaluateRule, type CandidateEvent, type RuleToEvaluate } from '../../_lib/alert-eval';
import type { AlertKind } from '../../alerts/_kinds';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 120;

/** Give a webhook this long before giving up. A slow Slack is not our problem. */
const SLACK_TIMEOUT_MS = 5_000;

/**
 * A compact Slack message. Deliberately plain text with a single bold line:
 * newsroom Slack channels are already noisy, and a wall of Block Kit for
 * "engagement went up" is how a useful alert becomes a muted one.
 */
function slackPayload(ruleName: string, events: CandidateEvent[]): string {
  const lines = ['*' + ruleName + '*'];
  for (const e of events.slice(0, 10)) {
    lines.push('- ' + e.title + (e.body ? ' — ' + e.body : ''));
  }
  if (events.length > 10) lines.push('- and ' + (events.length - 10) + ' more');
  return lines.join('\n');
}

async function deliver(
  destinations: AlertDestination[],
  ruleName: string,
  events: CandidateEvent[],
): Promise<{ delivered: number; failed: number }> {
  let delivered = 0;
  let failed = 0;

  for (const destination of destinations) {
    if (destination.type !== 'slack') continue;
    try {
      const res = await fetch(destination.webhookUrl, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ text: slackPayload(ruleName, events) }),
        signal: AbortSignal.timeout(SLACK_TIMEOUT_MS),
      });
      if (res.ok) delivered += 1;
      else {
        failed += 1;
        console.error('[pressbox:cron/alerts] slack responded ' + res.status);
      }
    } catch (err) {
      failed += 1;
      console.error('[pressbox:cron/alerts] slack delivery failed', err);
    }
  }

  return { delivered, failed };
}

/** Keys this rule has already announced recently, so we do not announce again. */
async function recentKeys(ruleId: string, lookbackDays: number): Promise<Set<string>> {
  const { start } = presetRange(lookbackDays);
  const rows = await db
    .select({ payload: alertEvents.payload })
    .from(alertEvents)
    .where(and(eq(alertEvents.ruleId, ruleId), gte(alertEvents.createdAt, start)));

  const keys = new Set<string>();
  for (const r of rows) {
    const key = r.payload?.dedupeKey;
    if (typeof key === 'string') keys.add(key);
  }
  return keys;
}

async function handle(req: NextRequest): Promise<Response> {
  assertCronAuthorized(req);

  const rows = await db
    .select({
      id: alertRules.id,
      orgId: alertRules.orgId,
      landscapeId: alertRules.landscapeId,
      name: alertRules.name,
      kind: alertRules.kind,
      config: alertRules.config,
      destinations: alertRules.destinations,
      lastFiredAt: alertRules.lastFiredAt,
    })
    .from(alertRules)
    .where(eq(alertRules.enabled, true));

  const summary = {
    rulesEvaluated: 0,
    rulesFailed: 0,
    eventsCreated: 0,
    notificationsSent: 0,
    notificationsFailed: 0,
  };

  for (const row of rows) {
    const rule: RuleToEvaluate = {
      id: row.id,
      orgId: row.orgId,
      landscapeId: row.landscapeId,
      name: row.name,
      kind: row.kind as AlertKind,
      config: readStoredConfig(row.config),
      lastFiredAt: row.lastFiredAt,
    };

    try {
      summary.rulesEvaluated += 1;
      const candidates = await evaluateRule(rule);
      const seen = await recentKeys(rule.id, rule.config.lookbackDays);
      const fresh = candidates.filter((c) => !seen.has(c.dedupeKey));

      // lastFiredAt advances on every successful evaluation, not only when
      // something fired. new_channel uses it as a watermark, and leaving it
      // behind would make that rule re-scan an ever-widening window.
      await db.update(alertRules)
        .set({ lastFiredAt: new Date() })
        .where(eq(alertRules.id, rule.id));

      if (fresh.length === 0) continue;

      await db.insert(alertEvents).values(fresh.map((c) => ({
        ruleId: rule.id,
        orgId: rule.orgId,
        title: c.title,
        body: c.body,
        severity: c.severity,
        payload: { ...c.payload, dedupeKey: c.dedupeKey },
      })));
      summary.eventsCreated += fresh.length;

      const result = await deliver(readStoredDestinations(row.destinations), rule.name, fresh);
      summary.notificationsSent += result.delivered;
      summary.notificationsFailed += result.failed;
    } catch (err) {
      // One broken rule must not take the run down; the rest still get evaluated.
      summary.rulesFailed += 1;
      console.error('[pressbox:cron/alerts] rule ' + rule.id + ' failed', err);
    }
  }

  return cronJson({ ok: true, ...summary });
}

export const GET = apiHandler(handle);
export const POST = apiHandler(handle);
