'use client';

import * as React from 'react';
import { ArrowDown, ArrowUp, ChevronsUpDown } from 'lucide-react';
import { cn } from '@/lib/utils';

export type SortDirection = 'asc' | 'desc';
export type Align = 'left' | 'right' | 'center';

export interface Column<T> {
  id: string;
  header: React.ReactNode;
  cell: (row: T, index: number) => React.ReactNode;
  /** Provide to make the column sortable locally. Return a comparable primitive. */
  sortValue?: (row: T) => number | string | null;
  /** Force sortability on or off. Required for server-sorted tables. */
  sortable?: boolean;
  align?: Align;
  /** Tailwind width class, e.g. "w-40". */
  width?: string;
  /** Hide below the given breakpoint to keep dense tables readable on laptops. */
  hideBelow?: 'sm' | 'md' | 'lg' | 'xl';
  headerClassName?: string;
  cellClassName?: string;
}

export interface DataTableProps<T> {
  rows: T[];
  columns: Column<T>[];
  getRowKey: (row: T, index: number) => string;
  /** Column id to sort by initially. */
  defaultSort?: { id: string; direction: SortDirection };
  /** Controlled sorting. When supplied, the table does not sort locally. */
  sort?: { id: string; direction: SortDirection };
  onSortChange?: (next: { id: string; direction: SortDirection }) => void;
  onRowClick?: (row: T) => void;
  empty?: React.ReactNode;
  /** Sticky header needs a scroll container with a bounded height. */
  maxHeight?: string;
  className?: string;
  caption?: string;
}

const ALIGN: Record<Align, string> = {
  left: 'text-left',
  right: 'text-right',
  center: 'text-center',
};

const HIDE: Record<NonNullable<Column<unknown>['hideBelow']>, string> = {
  sm: 'hidden sm:table-cell',
  md: 'hidden md:table-cell',
  lg: 'hidden lg:table-cell',
  xl: 'hidden xl:table-cell',
};

/**
 * Dense data table. No zebra striping: alternating fills add visual noise
 * without adding information, and a hairline row rule does the same job at a
 * fraction of the ink. Numeric columns are right-aligned and tabular so digits
 * stack into a scannable column.
 */
export function DataTable<T>({
  rows,
  columns,
  getRowKey,
  defaultSort,
  sort: controlledSort,
  onSortChange,
  onRowClick,
  empty,
  maxHeight,
  className,
  caption,
}: DataTableProps<T>) {
  const [localSort, setLocalSort] = React.useState(defaultSort);
  const controlled = controlledSort !== undefined;
  const sort = controlled ? controlledSort : localSort;

  const setSort = (id: string) => {
    const next: { id: string; direction: SortDirection } =
      sort && sort.id === id
        ? { id, direction: sort.direction === 'desc' ? 'asc' : 'desc' }
        : { id, direction: 'desc' };
    if (!controlled) setLocalSort(next);
    onSortChange?.(next);
  };

  const sorted = React.useMemo(() => {
    if (controlled || !sort) return rows;
    const col = columns.find((c) => c.id === sort.id);
    if (!col?.sortValue) return rows;
    const dir = sort.direction === 'asc' ? 1 : -1;
    return [...rows].sort((a, b) => {
      const av = col.sortValue?.(a);
      const bv = col.sortValue?.(b);
      if (av === null || av === undefined) return 1;
      if (bv === null || bv === undefined) return -1;
      if (typeof av === 'number' && typeof bv === 'number') return (av - bv) * dir;
      return String(av).localeCompare(String(bv)) * dir;
    });
  }, [rows, columns, sort, controlled]);

  if (rows.length === 0 && empty) return <>{empty}</>;

  return (
    <div
      className={cn('overflow-auto', className)}
      style={maxHeight ? { maxHeight } : undefined}
    >
      <table className="w-full border-collapse text-xs">
        {caption ? <caption className="sr-only">{caption}</caption> : null}
        <thead className="sticky top-0 z-10">
          <tr className="bg-zinc-50 dark:bg-zinc-900">
            {columns.map((c) => {
              const active = sort?.id === c.id;
              const align = c.align ?? 'left';
              const Icon = !active ? ChevronsUpDown : sort.direction === 'asc' ? ArrowUp : ArrowDown;
              return (
                <th
                  key={c.id}
                  scope="col"
                  aria-sort={active ? (sort.direction === 'asc' ? 'ascending' : 'descending') : undefined}
                  className={cn(
                    'border-b border-zinc-200 px-3 py-2 font-medium text-zinc-500 dark:border-zinc-800 dark:text-zinc-400',
                    ALIGN[align],
                    c.width,
                    c.hideBelow && HIDE[c.hideBelow],
                    c.headerClassName,
                  )}
                >
                  {(c.sortable ?? Boolean(c.sortValue)) ? (
                    <button
                      type="button"
                      onClick={() => setSort(c.id)}
                      className={cn(
                        'inline-flex items-center gap-1 whitespace-nowrap transition-colors hover:text-zinc-900 dark:hover:text-zinc-100',
                        active && 'text-zinc-900 dark:text-zinc-100',
                        align === 'right' && 'flex-row-reverse',
                      )}
                    >
                      {c.header}
                      <Icon
                        className={cn('h-3 w-3 shrink-0', active ? 'opacity-100' : 'opacity-40')}
                        aria-hidden
                      />
                    </button>
                  ) : (
                    <span className="whitespace-nowrap">{c.header}</span>
                  )}
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {sorted.map((row, i) => (
            <tr
              key={getRowKey(row, i)}
              onClick={onRowClick ? () => onRowClick(row) : undefined}
              className={cn(
                'border-b border-zinc-100 last:border-0 dark:border-zinc-800/60',
                'transition-colors hover:bg-zinc-50 dark:hover:bg-zinc-800/40',
                onRowClick && 'cursor-pointer',
              )}
            >
              {columns.map((c) => (
                <td
                  key={c.id}
                  className={cn(
                    'px-3 py-2 align-middle text-zinc-700 dark:text-zinc-300',
                    ALIGN[c.align ?? 'left'],
                    (c.align === 'right' || c.align === 'center') && 'pb-num',
                    c.hideBelow && HIDE[c.hideBelow],
                    c.cellClassName,
                  )}
                >
                  {c.cell(row, i)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** Rank pill used as the first column of every leaderboard-style table. */
export function RankCell({ rank, highlight }: { rank: number; highlight?: boolean }) {
  return (
    <span
      className={cn(
        'pb-num inline-flex h-5 w-5 items-center justify-center rounded text-[10px] font-semibold',
        highlight
          ? 'bg-accent-600 text-white'
          : 'bg-zinc-100 text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400',
      )}
    >
      {rank}
    </span>
  );
}
