'use client';

import * as React from 'react';
import { Check, ChevronDown, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Popover, PopoverTriggerSurface } from './popover';

export interface MultiSelectOption {
  value: string;
  label: string;
  /** Optional swatch, used for platforms and companies. */
  color?: string;
  count?: number;
}

export interface MultiSelectProps {
  options: MultiSelectOption[];
  value: string[];
  onChange: (next: string[]) => void;
  label: string;
  /** Shown when nothing is selected, which always means "all". */
  allLabel?: string;
  searchable?: boolean;
  className?: string;
  align?: 'start' | 'end';
}

/**
 * Checkbox list in a popover. An empty selection means "everything", which is
 * both the honest default and the one that keeps URLs short.
 */
export function MultiSelect({
  options,
  value,
  onChange,
  label,
  allLabel,
  searchable,
  className,
  align = 'start',
}: MultiSelectProps) {
  const [query, setQuery] = React.useState('');
  const selected = new Set(value);
  const filtered = query
    ? options.filter((o) => o.label.toLowerCase().includes(query.toLowerCase()))
    : options;

  const summary =
    value.length === 0
      ? (allLabel ?? 'All ' + label.toLowerCase())
      : value.length === 1
        ? (options.find((o) => o.value === value[0])?.label ?? '1 selected')
        : value.length + ' selected';

  const toggle = (v: string) => {
    onChange(selected.has(v) ? value.filter((x) => x !== v) : [...value, v]);
  };

  return (
    <Popover
      label={label}
      align={align}
      className={className}
      panelClassName="w-64"
      trigger={({ open }) => (
        <PopoverTriggerSurface open={open}>
          <span className="truncate text-xs font-medium text-zinc-500 dark:text-zinc-500">{label}</span>
          <span className="min-w-0 flex-1 truncate text-left text-xs">{summary}</span>
          <ChevronDown className="h-3.5 w-3.5 shrink-0 text-zinc-400" aria-hidden />
        </PopoverTriggerSurface>
      )}
    >
      {() => (
        <div>
          {searchable ? (
            <div className="border-b border-zinc-200 p-2 dark:border-zinc-700">
              <input
                autoFocus
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder={'Filter ' + label.toLowerCase()}
                className="h-7 w-full rounded border border-zinc-200 bg-transparent px-2 text-xs outline-none focus:border-accent-600 dark:border-zinc-700"
              />
            </div>
          ) : null}
          <div className="max-h-64 overflow-y-auto p-1">
            {filtered.length === 0 ? (
              <p className="px-2 py-6 text-center text-xs text-zinc-500">No matches.</p>
            ) : (
              filtered.map((o) => {
                const on = selected.has(o.value);
                return (
                  <button
                    key={o.value}
                    type="button"
                    onClick={() => toggle(o.value)}
                    className={cn(
                      'flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-xs transition-colors',
                      'hover:bg-zinc-100 dark:hover:bg-zinc-800',
                      on ? 'text-zinc-900 dark:text-zinc-100' : 'text-zinc-600 dark:text-zinc-400',
                    )}
                  >
                    <span
                      className={cn(
                        'flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded border',
                        on
                          ? 'border-accent-600 bg-accent-600 text-white'
                          : 'border-zinc-300 dark:border-zinc-600',
                      )}
                    >
                      {on ? <Check className="h-2.5 w-2.5" strokeWidth={3} aria-hidden /> : null}
                    </span>
                    {o.color ? (
                      <span
                        aria-hidden
                        className="h-2 w-2 shrink-0 rounded-full"
                        style={{ backgroundColor: o.color }}
                      />
                    ) : null}
                    <span className="min-w-0 flex-1 truncate">{o.label}</span>
                    {typeof o.count === 'number' ? (
                      <span className="pb-num shrink-0 text-[10px] text-zinc-400">{o.count}</span>
                    ) : null}
                  </button>
                );
              })
            )}
          </div>
          {value.length > 0 ? (
            <div className="border-t border-zinc-200 p-1 dark:border-zinc-700">
              <button
                type="button"
                onClick={() => onChange([])}
                className="flex w-full items-center gap-1.5 rounded px-2 py-1.5 text-xs text-zinc-500 transition-colors hover:bg-zinc-100 hover:text-zinc-900 dark:hover:bg-zinc-800 dark:hover:text-zinc-100"
              >
                <X className="h-3 w-3" aria-hidden />
                Clear selection
              </button>
            </div>
          ) : null}
        </div>
      )}
    </Popover>
  );
}
