'use client';

import * as React from 'react';
import { InfoTip } from '@/components/ui/tooltip';
import { MANUAL_FIGURES } from '@/lib/reports/types';
import { SectionCard } from './ui';

/**
 * Paid promotion and Apple News.
 *
 * Two numbers and four numbers respectively, from two dashboards this app has
 * no credentials for. A paste box would be ceremony for six fields, so they get
 * labelled inputs -- but they are still marked manual, because the label is the
 * contract: a reader must never have to guess whether a figure was measured or
 * typed.
 */
export function FigureFields({
  values,
  onChange,
  disabled,
}: {
  values: Record<string, string>;
  onChange: (next: Record<string, string>) => void;
  disabled?: boolean;
}) {
  const groups: { id: 'paid' | 'appleNews'; title: string; description: string }[] = [
    {
      id: 'paid',
      title: 'Paid Promotion',
      description: 'Year-to-date subscription starts and the blended cost of acquiring one.',
    },
    {
      id: 'appleNews',
      title: 'Boston.com Apple News',
      description: 'Apple News Publisher figures for the week, including News+ engaged minutes.',
    },
  ];

  return (
    <>
      {groups.map((group) => (
        <SectionCard key={group.id} title={group.title} kind="manual" description={group.description}>
          <div className="grid gap-4 p-4 sm:grid-cols-2">
            {MANUAL_FIGURES.filter((f) => f.group === group.id).map((figure) => (
              <div key={figure.id}>
                <div className="flex items-center gap-1.5">
                  <label
                    htmlFor={'figure-' + figure.id}
                    className="text-[11px] font-medium uppercase tracking-wider text-zinc-500 dark:text-zinc-400"
                  >
                    {figure.label}
                  </label>
                  <InfoTip content={figure.hint} label={figure.label} side="bottom" align="start" />
                </div>
                <input
                  id={'figure-' + figure.id}
                  value={values[figure.id] ?? ''}
                  onChange={(e) => onChange({ ...values, [figure.id]: e.target.value })}
                  disabled={disabled}
                  inputMode={figure.format === 'text' ? 'text' : 'decimal'}
                  placeholder={figure.format === 'usd' ? '$0.00' : '0'}
                  className="pb-num mt-1.5 h-9 w-full rounded-md border border-zinc-200 bg-white px-3 text-sm text-zinc-900 placeholder:text-zinc-400 transition-colors focus:border-accent-600 focus:outline-none dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-100 dark:placeholder:text-zinc-600"
                />
              </div>
            ))}
          </div>
        </SectionCard>
      ))}
    </>
  );
}
