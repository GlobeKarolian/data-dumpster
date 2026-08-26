/**
 * Cost reads for the Costs screen.
 *
 * Two ledgers with two different truth levels, and the screen never blends
 * them silently. `ai_usage` is metered actuals: OpenRouter's charged cost
 * written down per call. `vendor_spend` is computed estimates: records
 * delivered times a rate we hold in code, with the vendor's invoice as the
 * authoritative number. The point of the screen is early warning, and the
 * $232 group-collection invoice is why it exists: that number lived only on
 * the vendor's dashboard for a day while the collector kept buying.
 */
import { sql } from 'drizzle-orm';
import { db } from '@/db';
import { DATASETS } from '@/lib/vendors/brightdata';

/** Friendly names for dataset ids, so the table reads as products not hashes. */
const RESOURCE_NAMES: Record<string, string> = {
  [DATASETS.facebookGroupPosts]: 'Facebook group posts',
  [DATASETS.instagramComments]: 'Instagram comments',
  [DATASETS.instagramPost]: 'Instagram posts',
  [DATASETS.instagramProfile]: 'Instagram profiles',
  [DATASETS.instagramReel]: 'Instagram reels',
  [DATASETS.facebookPagesAndProfiles]: 'Facebook pages',
  [DATASETS.threadsPosts]: 'Threads posts',
  [DATASETS.threadsProfile]: 'Threads profiles',
  [DATASETS.tiktokComments]: 'TikTok comments',
};

export function resourceName(resource: string): string {
  return RESOURCE_NAMES[resource] ?? resource;
}

export interface DailyCost {
  /** YYYY-MM-DD in the report zone. */
  day: string;
  /** Metered actual, USD. */
  aiUsd: number;
  /** Computed estimate, USD. */
  vendorUsd: number;
}

/**
 * Cost per day, most recent first. Days are bucketed in the report zone like
 * every other daily number in the product, so "yesterday" here is the same
 * yesterday the rest of the tool means.
 */
export async function dailyCosts(days = 30): Promise<DailyCost[]> {
  const { rows } = await db.execute<{ day: string; ai: string | number; vendor: string | number }>(sql`
    WITH ai AS (
      SELECT to_char(created_at AT TIME ZONE 'America/New_York', 'YYYY-MM-DD') AS day,
             sum(cost_usd) AS usd
        FROM ai_usage
       WHERE created_at > now() - make_interval(days => ${days})
       GROUP BY 1
    ),
    vendor AS (
      SELECT to_char(created_at AT TIME ZONE 'America/New_York', 'YYYY-MM-DD') AS day,
             sum(estimated_cents)::numeric / 100 AS usd
        FROM vendor_spend
       WHERE created_at > now() - make_interval(days => ${days})
       GROUP BY 1
    )
    SELECT coalesce(ai.day, vendor.day) AS day,
           coalesce(ai.usd, 0) AS ai,
           coalesce(vendor.usd, 0) AS vendor
      FROM ai FULL OUTER JOIN vendor ON vendor.day = ai.day
     ORDER BY 1 DESC`);
  return rows.map((r) => ({
    day: r.day,
    aiUsd: Number(r.ai),
    vendorUsd: Number(r.vendor),
  }));
}

export interface CostTiles {
  todayUsd: number;
  yesterdayUsd: number;
  last7Usd: number;
  monthToDateUsd: number;
}

export function costTiles(daily: DailyCost[]): CostTiles {
  const tz = 'America/New_York';
  const fmt = (d: Date) => new Intl.DateTimeFormat('en-CA', {
    timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(d);
  const today = fmt(new Date());
  const yesterday = fmt(new Date(Date.now() - 86_400_000));
  const monthPrefix = today.slice(0, 7);
  const total = (c: DailyCost) => c.aiUsd + c.vendorUsd;
  return {
    todayUsd: daily.filter((c) => c.day === today).reduce((s, c) => s + total(c), 0),
    yesterdayUsd: daily.filter((c) => c.day === yesterday).reduce((s, c) => s + total(c), 0),
    last7Usd: daily.slice(0, 50).filter((c) => c.day > fmt(new Date(Date.now() - 7 * 86_400_000)))
      .reduce((s, c) => s + total(c), 0),
    monthToDateUsd: daily.filter((c) => c.day.startsWith(monthPrefix))
      .reduce((s, c) => s + total(c), 0),
  };
}

export interface AiFeatureCost {
  feature: string;
  calls: number;
  usd: number;
}

export async function aiCostsByFeature(days = 30): Promise<AiFeatureCost[]> {
  const { rows } = await db.execute<{ feature: string | null; calls: string | number; usd: string | number }>(sql`
    SELECT coalesce(feature, 'other') AS feature, count(*) AS calls, sum(cost_usd) AS usd
      FROM ai_usage
     WHERE created_at > now() - make_interval(days => ${days})
     GROUP BY 1 ORDER BY 3 DESC`);
  return rows.map((r) => ({
    feature: r.feature ?? 'other',
    calls: Number(r.calls),
    usd: Number(r.usd),
  }));
}

export interface VendorResourceCost {
  resource: string;
  name: string;
  purchases: number;
  records: number;
  stored: number;
  usd: number;
}

export async function vendorCostsByResource(days = 30): Promise<VendorResourceCost[]> {
  const { rows } = await db.execute<{
    resource: string; purchases: string | number; records: string | number;
    stored: string | number; usd: string | number;
  }>(sql`
    SELECT resource, count(*) AS purchases, coalesce(sum(records), 0) AS records,
           coalesce(sum(stored), 0) AS stored,
           coalesce(sum(estimated_cents), 0)::numeric / 100 AS usd
      FROM vendor_spend
     WHERE created_at > now() - make_interval(days => ${days})
     GROUP BY 1 ORDER BY 5 DESC`);
  return rows.map((r) => ({
    resource: r.resource,
    name: resourceName(r.resource),
    purchases: Number(r.purchases),
    records: Number(r.records),
    stored: Number(r.stored),
    usd: Number(r.usd),
  }));
}
