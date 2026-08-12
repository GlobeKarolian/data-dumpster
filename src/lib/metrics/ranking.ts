/**
 * Product-wide ordering for metric-driven company and brand lists.
 *
 * Measured finite values sort from highest to lowest. Missing values stay
 * visible but always fall to the bottom. Names make ties deterministic so a
 * rerender never appears to reshuffle equally performing brands.
 */
export function sortByMetricDescending<T>(
  rows: readonly T[],
  valueOf: (row: T) => number | null | undefined,
  nameOf: (row: T) => string,
): T[] {
  return [...rows].sort((a, b) => {
    const aValue = valueOf(a);
    const bValue = valueOf(b);
    const aMeasured = typeof aValue === 'number' && Number.isFinite(aValue);
    const bMeasured = typeof bValue === 'number' && Number.isFinite(bValue);

    if (aMeasured !== bMeasured) return aMeasured ? -1 : 1;
    if (aMeasured && bMeasured && aValue !== bValue) return bValue - aValue;
    return nameOf(a).localeCompare(nameOf(b));
  });
}
