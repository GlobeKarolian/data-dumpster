/**
 * Pick the comparison target implied by a company filter.
 *
 * An empty selection means the whole landscape and keeps its configured focus.
 * If the configured focus was filtered out, the first selected company becomes
 * the focus everywhere so highlights, averages and prose cannot disagree.
 */
export function effectiveFocusCompanyId(
  focusCompanyId: string | null,
  selectedCompanyIds?: readonly string[],
): string | null {
  if (!selectedCompanyIds || selectedCompanyIds.length === 0) return focusCompanyId;
  if (focusCompanyId && selectedCompanyIds.includes(focusCompanyId)) return focusCompanyId;
  return selectedCompanyIds[0] ?? null;
}

export function companiesInScope<T extends { id: string }>(
  companies: readonly T[],
  selectedCompanyIds?: readonly string[],
): T[] {
  if (!selectedCompanyIds || selectedCompanyIds.length === 0) return [...companies];
  const selected = new Set(selectedCompanyIds);
  return companies.filter((company) => selected.has(company.id));
}

