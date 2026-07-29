'use client';

import * as React from 'react';
import { Plus, Table2, Trash2, Type } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { formatRelative } from '@/components/ui/format';
import { cn } from '@/lib/utils';
import type { ManualSectionSpec, ManualTable } from '@/lib/reports/types';
import { emptyTable, parseTable, rowsToTsv } from '@/lib/reports/tsv';
import { SectionCard } from './ui';

const DELIMITER_LABEL: Record<string, string> = {
  tab: 'tab separated',
  comma: 'comma separated',
  spaces: 'aligned columns',
  single: 'single column',
};

/**
 * A manual section: paste in, table out.
 *
 * There are two ways to get data in here and both are first class. Paste mode
 * takes whatever the clipboard holds and parses it. Grid mode is the editable
 * fallback for the cases parsing cannot solve -- a stray column, a figure that
 * needs correcting, a row that should not have been copied. The parsed rows and
 * the raw paste are kept in step in both directions, so switching modes never
 * loses work and a bad parse is always recoverable.
 */
export function PasteBox({
  spec,
  table,
  onChange,
  disabled,
}: {
  spec: ManualSectionSpec;
  table: ManualTable;
  onChange: (next: ManualTable) => void;
  disabled?: boolean;
}) {
  const [mode, setMode] = React.useState<'paste' | 'grid'>(
    table.rows.length > 0 ? 'grid' : 'paste',
  );
  const parsed = React.useMemo(() => parseTable(table.raw, spec.columns), [table.raw, spec.columns]);

  const applyRaw = (raw: string) => {
    const result = parseTable(raw, spec.columns);
    onChange({ raw, rows: result.rows, updatedAt: raw.trim() ? new Date().toISOString() : null });
  };

  const applyRows = (rows: string[][]) => {
    onChange({ raw: rowsToTsv(rows), rows, updatedAt: new Date().toISOString() });
  };

  const setCell = (rowIndex: number, colIndex: number, value: string) => {
    const rows = table.rows.map((row, i) =>
      i === rowIndex ? row.map((cell, j) => (j === colIndex ? value : cell)) : row);
    applyRows(rows);
  };

  const rowCount = table.rows.length;

  return (
    <SectionCard
      title={spec.title}
      kind="manual"
      description={spec.hint}
      actions={
        <div className="flex items-center gap-1">
          <Button
            size="sm"
            variant={mode === 'paste' ? 'secondary' : 'ghost'}
            onClick={() => setMode('paste')}
            aria-pressed={mode === 'paste'}
          >
            <Type className="h-3 w-3" aria-hidden />
            Paste
          </Button>
          <Button
            size="sm"
            variant={mode === 'grid' ? 'secondary' : 'ghost'}
            onClick={() => setMode('grid')}
            aria-pressed={mode === 'grid'}
            disabled={rowCount === 0}
          >
            <Table2 className="h-3 w-3" aria-hidden />
            Edit
          </Button>
          {rowCount > 0 ? (
            <Button size="sm" variant="ghost" onClick={() => { onChange(emptyTable()); setMode('paste'); }}>
              Clear
            </Button>
          ) : null}
        </div>
      }
      footer={
        rowCount > 0 ? (
          <span className="pb-num">
            {rowCount + (rowCount === 1 ? ' row' : ' rows')
              + ' · ' + (DELIMITER_LABEL[parsed.delimiter] ?? parsed.delimiter)
              + (parsed.headerDropped ? ' · header row dropped' : '')
              + (table.updatedAt ? ' · entered ' + formatRelative(table.updatedAt) : '')}
          </span>
        ) : (
          <span>Nothing pasted yet. This section will be omitted from the export.</span>
        )
      }
    >
      {mode === 'paste' ? (
        <div className="space-y-2 p-4">
          <textarea
            value={table.raw}
            onChange={(e) => applyRaw(e.target.value)}
            disabled={disabled}
            spellCheck={false}
            rows={rowCount > 0 ? 6 : 5}
            placeholder={
              'Paste rows here. Columns: ' + spec.columns.map((c) => c.label).join(', ') + '.'
            }
            className="w-full rounded-md border border-zinc-200 bg-white px-3 py-2 font-mono text-xs leading-relaxed text-zinc-900 placeholder:text-zinc-400 transition-colors focus:border-accent-600 focus:outline-none dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-100 dark:placeholder:text-zinc-600"
          />
          {rowCount > 0 ? <PreviewTable spec={spec} rows={table.rows} /> : null}
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full border-collapse">
            <thead className="border-b border-zinc-200 dark:border-zinc-800">
              <tr>
                {spec.columns.map((c) => (
                  <th
                    key={c.key}
                    scope="col"
                    className={cn(
                      'px-3 py-2 text-[11px] font-medium uppercase tracking-wider text-zinc-500 dark:text-zinc-400',
                      c.numeric ? 'text-right' : 'text-left',
                    )}
                  >
                    {c.label}
                  </th>
                ))}
                <th className="w-8 px-2" />
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800/60">
              {table.rows.map((row, i) => (
                <tr key={i}>
                  {spec.columns.map((c, j) => (
                    <td key={c.key} className="px-1 py-1">
                      <input
                        value={row[j] ?? ''}
                        onChange={(e) => setCell(i, j, e.target.value)}
                        disabled={disabled}
                        className={cn(
                          'w-full rounded border border-transparent bg-transparent px-2 py-1 text-sm text-zinc-800 transition-colors',
                          'hover:border-zinc-200 focus:border-accent-600 focus:outline-none dark:text-zinc-200 dark:hover:border-zinc-700',
                          c.numeric && 'pb-num text-right',
                        )}
                      />
                    </td>
                  ))}
                  <td className="px-1 py-1 text-right">
                    <button
                      type="button"
                      onClick={() => applyRows(table.rows.filter((_, k) => k !== i))}
                      className="rounded p-1 text-zinc-400 transition-colors hover:bg-zinc-100 hover:text-red-600 dark:hover:bg-zinc-800"
                      aria-label={'Remove row ' + (i + 1)}
                    >
                      <Trash2 className="h-3 w-3" aria-hidden />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="border-t border-zinc-200 px-3 py-2 dark:border-zinc-800">
            <Button
              size="sm"
              variant="ghost"
              onClick={() => applyRows([...table.rows, spec.columns.map(() => '')])}
              disabled={disabled}
            >
              <Plus className="h-3 w-3" aria-hidden />
              Add row
            </Button>
          </div>
        </div>
      )}
    </SectionCard>
  );
}

/** Read-only confirmation of what the parser understood, shown under the paste box. */
function PreviewTable({ spec, rows }: { spec: ManualSectionSpec; rows: string[][] }) {
  const shown = rows.slice(0, 8);
  return (
    <div className="overflow-x-auto rounded-md border border-zinc-200 dark:border-zinc-800">
      <table className="w-full border-collapse">
        <thead className="border-b border-zinc-200 bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-900/60">
          <tr>
            {spec.columns.map((c) => (
              <th
                key={c.key}
                scope="col"
                className={cn(
                  'px-3 py-1.5 text-[10px] font-medium uppercase tracking-wider text-zinc-500 dark:text-zinc-400',
                  c.numeric ? 'text-right' : 'text-left',
                )}
              >
                {c.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800/60">
          {shown.map((row, i) => (
            <tr key={i}>
              {spec.columns.map((c, j) => (
                <td
                  key={c.key}
                  className={cn(
                    'px-3 py-1.5 text-xs text-zinc-700 dark:text-zinc-300',
                    c.numeric && 'pb-num text-right',
                  )}
                >
                  {row[j] || '—'}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      {rows.length > shown.length ? (
        <p className="border-t border-zinc-200 px-3 py-1.5 text-[11px] text-zinc-500 dark:border-zinc-800">
          {(rows.length - shown.length) + ' more rows will be included in the export.'}
        </p>
      ) : null}
    </div>
  );
}
