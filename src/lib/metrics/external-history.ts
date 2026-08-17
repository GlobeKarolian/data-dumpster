/**
 * Vendor-reported brand-week history, for periods this product never observed.
 *
 * This is deliberately its own module and its own chart rather than a fallback
 * inside the main series. A vendor's weekly engagement total and our own
 * post-derived total are different measurements: different collection windows,
 * different post sets, different definitions of what counts as engagement.
 * Blending them into one line would produce a curve where a step change means
 * "the source changed" while looking exactly like "the audience changed", and
 * nothing downstream could tell the two apart afterwards.
 *
 * So: same shape as a normal time series, so charts can render it unmodified,
 * but always labelled with its source and never merged with computed metrics.
 */
import { and, eq, gte, inArray, lte } from 'drizzle-orm';
import { db } from '@/db';
import { externalBrandMetrics } from '@/db/schema';
import type { Platform, TimeSeriesPoint } from '@/lib/types';

export interface ExternalHistoryQuery {
  companyIds: string[];
  /** MetricKey-compatible name, e.g. 'engagementTotal'. */
  metric: string;
  start: Date;
  end: Date;
  platforms?: Platform[];
  source?: string;
}

export interface ExternalHistoryResult {
  series: TimeSeriesPoint[];
  /** Distinct sources contributing, so the UI can name them honestly. */
  sources: string[];
  /** Earliest and latest period actually present, for an accurate caption. */
  earliest: string | null;
  latest: string | null;
}

function toDayString(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/**
 * One point per period, one key per company, values summed across platforms.
 *
 * Summing across platforms is correct here because these are flows: a week's
 * Facebook engagement plus that week's Instagram engagement is that week's
 * engagement. The same operation on an audience stock would be wrong, which is
 * why this module refuses stock metrics outright.
 */
export async function getExternalBrandHistory(
  q: ExternalHistoryQuery,
): Promise<ExternalHistoryResult> {
  if (q.companyIds.length === 0) {
    return { series: [], sources: [], earliest: null, latest: null };
  }
  if (q.metric === 'audience') {
    throw new Error(
      'getExternalBrandHistory refuses stock metrics: summing audience across '
      + 'platforms and periods is not a number that means anything. Audience '
      + 'history lives in audience_snapshots and is read through queries.ts.',
    );
  }

  const rows = await db
    .select({
      companyId: externalBrandMetrics.companyId,
      periodStart: externalBrandMetrics.periodStart,
      value: externalBrandMetrics.value,
      source: externalBrandMetrics.source,
    })
    .from(externalBrandMetrics)
    .where(and(
      inArray(externalBrandMetrics.companyId, q.companyIds),
      eq(externalBrandMetrics.metric, q.metric),
      gte(externalBrandMetrics.periodStart, toDayString(q.start)),
      lte(externalBrandMetrics.periodStart, toDayString(q.end)),
      ...(q.platforms?.length ? [inArray(externalBrandMetrics.platform, q.platforms)] : []),
      ...(q.source ? [eq(externalBrandMetrics.source, q.source)] : []),
    ));

  const byPeriod = new Map<string, Map<string, number>>();
  const sources = new Set<string>();
  for (const row of rows) {
    sources.add(row.source);
    const period = byPeriod.get(row.periodStart) ?? new Map<string, number>();
    period.set(row.companyId, (period.get(row.companyId) ?? 0) + row.value);
    byPeriod.set(row.periodStart, period);
  }

  const periods = [...byPeriod.keys()].sort();
  const series: TimeSeriesPoint[] = periods.map((period) => {
    const point: TimeSeriesPoint = { date: period };
    const values = byPeriod.get(period);
    for (const companyId of q.companyIds) {
      // A company absent from a vendor week was not measured that week; null
      // keeps it out of the line instead of drawing a false zero.
      point[companyId] = values?.get(companyId) ?? null;
    }
    return point;
  });

  return {
    series,
    sources: [...sources].sort(),
    earliest: periods[0] ?? null,
    latest: periods[periods.length - 1] ?? null,
  };
}
