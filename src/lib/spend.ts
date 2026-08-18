/**
 * Spend meters for /api/health.
 *
 * Everything here is either a number our own database recorded (AI inference,
 * from ai_usage) or a number the vendor's own usage API reports (X, from
 * /2/usage/tweets). Bright Data has no spend figure we can read directly, so
 * it is reported as delivered-record VOLUME and labelled estimate:true —
 * per the house rule, an estimate must never dress as a measurement.
 *
 * Cached in module memory for ten minutes: health is polled by uptime probes,
 * and the X usage endpoint has its own rate limit that a probe must not eat.
 */
import { sql } from 'drizzle-orm';
import { db } from '@/db';

export interface SpendReport {
  x: {
    /** Project-level tweets read this month, from the official usage API. */
    monthReads: number | null;
    monthCap: number | null;
    pctOfCap: number | null;
    error?: string;
  } | null;
  ai: {
    todayUsd: number;
    monthUsd: number;
    byFeatureToday: Record<string, number>;
  };
  brightdata: {
    estimate: true;
    recordsDeliveredToday: number;
    recordsDeliveredMonth: number;
  };
}

let cache: { at: number; report: SpendReport } | null = null;
const CACHE_MS = 10 * 60_000;

async function xUsage(): Promise<SpendReport['x']> {
  const bearer = process.env.TWITTER_BEARER_TOKEN?.trim();
  if (!bearer) return null;
  try {
    const res = await fetch('https://api.x.com/2/usage/tweets', {
      headers: { authorization: `Bearer ${bearer}` },
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) {
      return { monthReads: null, monthCap: null, pctOfCap: null, error: `usage API ${res.status}` };
    }
    const body = await res.json() as {
      data?: { project_usage?: string | number; project_cap?: string | number };
    };
    const used = Number(body.data?.project_usage ?? NaN);
    const cap = Number(body.data?.project_cap ?? NaN);
    return {
      monthReads: Number.isFinite(used) ? used : null,
      monthCap: Number.isFinite(cap) ? cap : null,
      pctOfCap: Number.isFinite(used) && Number.isFinite(cap) && cap > 0
        ? Math.round((used / cap) * 1000) / 10
        : null,
    };
  } catch (err) {
    return {
      monthReads: null, monthCap: null, pctOfCap: null,
      error: err instanceof Error ? err.message : 'unreachable',
    };
  }
}

async function aiSpend(): Promise<SpendReport['ai']> {
  const { rows } = await db.execute<{ scope: string; feature: string; usd: string | number }>(sql`
    SELECT scope, feature, sum(cost_usd) AS usd FROM (
      SELECT 'today' AS scope, feature, cost_usd FROM ai_usage
       WHERE created_at >= date_trunc('day', now())
      UNION ALL
      SELECT 'month' AS scope, feature, cost_usd FROM ai_usage
       WHERE created_at >= date_trunc('month', now())
    ) u GROUP BY scope, feature`);
  const report = { todayUsd: 0, monthUsd: 0, byFeatureToday: {} as Record<string, number> };
  for (const r of rows) {
    const usd = Number(r.usd) || 0;
    if (r.scope === 'today') {
      report.todayUsd += usd;
      report.byFeatureToday[r.feature] = Math.round(((report.byFeatureToday[r.feature] ?? 0) + usd) * 10000) / 10000;
    } else {
      report.monthUsd += usd;
    }
  }
  report.todayUsd = Math.round(report.todayUsd * 100) / 100;
  report.monthUsd = Math.round(report.monthUsd * 100) / 100;
  return report;
}

async function brightdataVolume(): Promise<SpendReport['brightdata']> {
  // Bright Data bills per delivered record; posts+snapshots written by runs
  // whose winning source was brightdata approximate delivered volume. An
  // approximation is labelled as one and never priced in dollars here.
  const { rows } = await db.execute<{ scope: string; records: string | number }>(sql`
    SELECT scope, sum(records) AS records FROM (
      SELECT 'today' AS scope, posts_upserted + snapshots_upserted AS records
        FROM ingestion_runs
       WHERE source_key = 'brightdata' AND started_at >= date_trunc('day', now())
      UNION ALL
      SELECT 'month' AS scope, posts_upserted + snapshots_upserted AS records
        FROM ingestion_runs
       WHERE source_key = 'brightdata' AND started_at >= date_trunc('month', now())
    ) u GROUP BY scope`);
  const today = rows.find((r) => r.scope === 'today');
  const month = rows.find((r) => r.scope === 'month');
  return {
    estimate: true,
    recordsDeliveredToday: Number(today?.records ?? 0),
    recordsDeliveredMonth: Number(month?.records ?? 0),
  };
}

export async function spendReport(): Promise<SpendReport> {
  if (cache && Date.now() - cache.at < CACHE_MS) return cache.report;
  const [x, ai, brightdata] = await Promise.all([xUsage(), aiSpend(), brightdataVolume()]);
  const report: SpendReport = { x, ai, brightdata };
  cache = { at: Date.now(), report };
  return report;
}
