'use client';

import * as React from 'react';
import { MultiSelect } from '@/components/ui/multi-select';
import { useUrlState } from '@/components/common/use-url-state';
import { companyColor } from '@/components/charts/theme';

export interface CompanyOption {
  id: string;
  name: string;
  color?: string | null;
}

/**
 * Narrows every screen to a subset of the landscape. Empty means all of it,
 * which keeps the common case out of the URL entirely.
 */
export function CompanyFilter({
  companies,
  focusCompanyId,
}: {
  companies: CompanyOption[];
  focusCompanyId: string | null;
}) {
  const { getList, setParams } = useUrlState();
  const value = getList('companies');

  if (companies.length === 0) return null;

  return (
    <MultiSelect
      label="Companies"
      align="end"
      searchable={companies.length > 8}
      className="w-52"
      allLabel={'All ' + companies.length + ' companies'}
      options={companies.map((c, i) => ({
        value: c.id,
        label: c.name,
        color: companyColor({ id: c.id, color: c.color }, i, focusCompanyId),
      }))}
      value={value}
      onChange={(next) => setParams({ companies: next })}
    />
  );
}

/** Platform narrowing, used on cross-channel and content screens. */
export function PlatformFilter({
  options,
}: {
  options: { value: string; label: string; color?: string }[];
}) {
  const { getList, setParams } = useUrlState();
  const value = getList('platforms');
  if (options.length === 0) return null;
  return (
    <MultiSelect
      label="Platforms"
      align="end"
      className="w-48"
      allLabel="All platforms"
      options={options}
      value={value}
      onChange={(next) => setParams({ platforms: next })}
    />
  );
}
