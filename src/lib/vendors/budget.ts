/**
 * Vendor spend accounting, and the ceiling that stops a runaway.
 *
 * The group collector once bought 57,037 records in a round it believed was
 * capped at 150, on a six-hour schedule, and the first anyone knew of it was a
 * $232 line on Bright Data's dashboard a day later. Two things were missing and
 * both are here: a record of what each purchase actually cost, and a limit the
 * code checks before buying rather than after.
 *
 * The ceiling is counted in records, not dollars, because records are what we
 * can observe at the moment of purchase. Dollars are the vendor's arithmetic on
 * top of that, and we hold their rate in code as an estimate that must never be
 * presented as the invoice.
 */
import { sql } from 'drizzle-orm';
import { db } from '@/db';
import { vendorSpend } from '@/db/schema';

/**
 * Bright Data's published rate for these datasets, $1.50 per 1,000 records, as
 * tenths of a cent per record. Held here so an estimate is traceable to one
 * number rather than being recomputed inline at three call sites.
 */
const BRIGHTDATA_TENTHS_OF_CENT_PER_RECORD = 1.5;

export function estimateBrightDataCents(records: number): number {
  return Math.round((records * BRIGHTDATA_TENTHS_OF_CENT_PER_RECORD) / 10);
}

/**
 * Records per rolling 24 hours that group collection may buy, across all
 * groups and all orgs.
 *
 * Normal operation is nowhere near it: three groups, seventy-five records
 * apiece, four rounds a day is 900 records, about $1.35. The ceiling is set at
 * roughly three times that so an ordinary busy day never trips it, and set at
 * all so that a vendor change which quietly stops honouring `limit_per_input`
 * costs a few dollars and a paused collector rather than another $232.
 */
export const GROUP_DAILY_RECORD_BUDGET = 2_500;

/**
 * Records per rolling 24 hours for Instagram comment collection.
 *
 * The whole IG corpus reports ~1,500 new comments a day, so 4,000 is roughly
 * 2.5x an ordinary day: never tripped by news, tripped immediately by a
 * vendor change that stops honouring caps. About $6 if fully spent.
 */
export const IG_COMMENT_DAILY_RECORD_BUDGET = 4_000;

export interface SpendWindow {
  records: number;
  stored: number;
  estimatedCents: number;
  purchases: number;
}

/**
 * What a vendor has cost us over the trailing `hours`, from our own ledger.
 * Pass `resource` to scope to one dataset, so the comment budget and the
 * group budget cannot starve each other despite sharing a vendor.
 */
export async function spendSince(
  vendor: string,
  hours: number,
  resource?: string,
): Promise<SpendWindow> {
  const { rows } = await db.execute<{
    records: string | number; stored: string | number;
    cents: string | number; purchases: string | number;
  }>(sql`
    SELECT coalesce(sum(records), 0) AS records,
           coalesce(sum(stored), 0) AS stored,
           coalesce(sum(estimated_cents), 0) AS cents,
           count(*) AS purchases
      FROM vendor_spend
     WHERE vendor = ${vendor}
       AND (${resource ?? null}::text IS NULL OR resource = ${resource ?? null})
       AND created_at > now() - make_interval(hours => ${hours})`);
  const r = rows[0];
  return {
    records: Number(r?.records ?? 0),
    stored: Number(r?.stored ?? 0),
    estimatedCents: Number(r?.cents ?? 0),
    purchases: Number(r?.purchases ?? 0),
  };
}

/**
 * How many records may still be bought under the given rolling budget.
 *
 * Returns zero rather than a negative number, so a caller can treat the result
 * as "how much may I ask for" without a second guard.
 */
export async function remainingRecordBudget(
  vendor: string,
  budget: number,
  hours = 24,
  resource?: string,
): Promise<number> {
  const spent = await spendSince(vendor, hours, resource);
  return Math.max(0, budget - spent.records);
}

/**
 * Write a purchase down. Called after every trigger that delivered records,
 * including ones whose rows we then discarded as duplicates, because the vendor
 * bills for delivery rather than for novelty.
 */
export async function recordSpend(entry: {
  orgId?: string | null;
  vendor: string;
  resource: string;
  subject?: string | null;
  records: number;
  stored: number;
  snapshotId?: string | null;
  estimatedCents: number;
}): Promise<void> {
  await db.insert(vendorSpend).values({
    orgId: entry.orgId ?? null,
    vendor: entry.vendor,
    resource: entry.resource,
    subject: entry.subject ?? null,
    records: Math.max(0, Math.trunc(entry.records)),
    stored: Math.max(0, Math.trunc(entry.stored)),
    snapshotId: entry.snapshotId ?? null,
    estimatedCents: Math.max(0, Math.trunc(entry.estimatedCents)),
  });
}
