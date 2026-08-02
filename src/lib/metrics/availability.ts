import type { MetricRow } from '@/lib/types';

/**
 * Mean of measured competitors only.
 *
 * A measured zero is real and belongs in the denominator. An unavailable row
 * is neither zero nor a competitor observation and must be excluded.
 */
export function measuredCompetitorAverage(
  rows: readonly MetricRow[],
  focusCompanyId?: string | null,
): number | null {
  const measured = rows.filter((row) =>
    row.company.id !== focusCompanyId
    && row.available
    && Number.isFinite(row.value));
  if (measured.length === 0) return null;
  return measured.reduce((sum, row) => sum + row.value, 0) / measured.length;
}
