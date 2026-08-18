'use client';

import * as React from 'react';
import { AlertTriangle, ChevronRight, FileUp, Plus, Table2, Trash2, Type } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { formatRelative } from '@/components/ui/format';
import { cn } from '@/lib/utils';
import type { ManualSectionSpec, ManualTable } from '@/lib/reports/types';
import { emptyTable, parseTable, rowsToTsv } from '@/lib/reports/tsv';
import { reportManualRows } from '@/lib/reports/manual-rows';
import { importAdobeFreeform, describeImport, type ImportSummary } from '@/lib/reports/freeform-import';
import { readTabularFile } from '@/lib/reports/tabular-file';
import { SectionCard } from './ui';
import { ReferralChart } from './referral-chart';
import { SearchScreenshotImport } from './search-screenshot-import';

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
  const [importState, setImportState] = React.useState<ImportState>({ status: 'idle' });
  // Single-open accordion: the breakdowns are short and several open at once
  // pushes the table itself off screen.
  const [expanded, setExpanded] = React.useState<string | null>(null);
  const parsed = React.useMemo(() => parseTable(table.raw, spec.columns), [table.raw, spec.columns]);
  const currentRows = React.useMemo(
    () => reportManualRows(spec.id, table),
    [spec.id, table],
  );

  const applyRaw = (raw: string) => {
    const result = parseTable(raw, spec.columns);
    onChange({ raw, rows: result.rows, updatedAt: raw.trim() ? new Date().toISOString() : null });
  };

  const applyRows = (rows: string[][]) => {
    onChange({ raw: rowsToTsv(rows), rows, updatedAt: new Date().toISOString() });
  };

  /**
   * Read a dropped or chosen file.
   *
   * A failed import deliberately leaves the existing table alone. The common
   * mistake is grabbing the wrong export out of a downloads folder, and wiping
   * good rows to replace them with an error message would punish it twice.
   */
  const importFile = async (file: File) => {
    setImportState({ status: 'reading' });
    try {
      const read = await readTabularFile(file);
      if (!read.ok) {
        setImportState({ status: 'error', problems: read.problems, fileName: file.name });
        return;
      }
      const result = importAdobeFreeform(read.text, spec.importRank ?? 'subscriptions');
      if (!result.ok) {
        setImportState({
          status: 'error',
          fileName: file.name,
          problems: read.kind === 'excel' && read.sheetNames.length > 1
            ? [...result.problems,
              `All ${read.sheetNames.length} sheets were searched: `
              + read.sheetNames.join(', ') + '.']
            : result.problems,
        });
        return;
      }
      onChange(result.table);
      setImportState({ status: 'ok', summary: result.summary, fileName: file.name });
      setMode('grid');
    } catch {
      setImportState({
        status: 'error',
        fileName: file.name,
        problems: ['The file could not be read. If it is open in Excel, close it and try again.'],
      });
    }
  };

  const setCell = (rowIndex: number, colIndex: number, value: string) => {
    const rows = currentRows.map((row, i) =>
      i === rowIndex ? row.map((cell, j) => (j === colIndex ? value : cell)) : row);
    applyRows(rows);
  };

  const rowCount = currentRows.length;

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
        importState.status === 'ok' ? (
          <ImportFooter summary={importState.summary} fileName={importState.fileName}
            updatedAt={table.updatedAt} />
        ) : rowCount > 0 ? (
          <span className="pb-num">
            {rowCount + (rowCount === 1 ? ' row' : ' rows')
              + ' · ' + (DELIMITER_LABEL[parsed.delimiter] ?? parsed.delimiter)
              + (parsed.headerDropped ? ' · header row dropped' : '')
              + (table.updatedAt ? ' · entered ' + formatRelative(table.updatedAt) : '')}
          </span>
        ) : (
          <span>
            {spec.importer
              ? 'Nothing imported yet. This section will be omitted from the export.'
              : 'Nothing pasted yet. This section will be omitted from the export.'}
          </span>
        )
      }
    >
      {mode === 'paste' ? (
        <div className="space-y-2 p-4">
          {spec.importer === 'adobeFreeform' ? (
            <>
              <DropZone
                hint={spec.importHint}
                state={importState}
                disabled={disabled}
                onFile={importFile}
              />
              <p className="text-center text-[11px] text-zinc-400 dark:text-zinc-500">
                or paste rows directly
              </p>
            </>
          ) : null}
          {spec.importer === 'searchScreenshot' ? (
            <>
              <SearchScreenshotImport
                spec={spec}
                disabled={disabled}
                onApply={(next, opts) => {
                  onChange(next);
                  // Rows are saved on arrival; the panel stays open for review
                  // and only collapses once the editor says they are done.
                  if (opts?.done) setMode('grid');
                }}
              />
              <p className="text-center text-[11px] text-zinc-400 dark:text-zinc-500">
                or paste rows directly
              </p>
            </>
          ) : null}
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
          {rowCount > 0 ? <PreviewTable spec={spec} rows={currentRows} /> : null}
        </div>
      ) : (
        <div>
          {spec.importer === 'adobeFreeform' && rowCount > 0 ? (
            <div className="border-b border-zinc-200 p-4 dark:border-zinc-800">
              <ReferralChart rows={currentRows} rank={spec.importRank ?? 'subscriptions'} />
            </div>
          ) : null}
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
              {currentRows.map((row, i) => {
                const parts = table.breakdown?.[row[0] ?? ''];
                const isOpen = expanded === row[0];
                return (
                  <React.Fragment key={i}>
                    <tr>
                      {spec.columns.map((c, j) => (
                        <td key={c.key} className="px-1 py-1">
                          {j === 0 && parts ? (
                            <div className="flex items-center gap-1">
                              <button
                                type="button"
                                onClick={() => setExpanded(isOpen ? null : row[0])}
                                aria-expanded={isOpen}
                                title={`Show the ${parts.length} hostnames folded into ${row[0]}`}
                                className="shrink-0 rounded p-0.5 text-zinc-400 transition-colors hover:bg-zinc-100 hover:text-zinc-700 dark:hover:bg-zinc-800 dark:hover:text-zinc-200"
                              >
                                <ChevronRight
                                  className={cn('h-3 w-3 transition-transform', isOpen && 'rotate-90')}
                                  aria-hidden
                                />
                              </button>
                              <input
                                value={row[j] ?? ''}
                                onChange={(e) => setCell(i, j, e.target.value)}
                                disabled={disabled}
                                className="w-full rounded border border-transparent bg-transparent px-1 py-1 text-sm text-zinc-800 transition-colors hover:border-zinc-200 focus:border-accent-600 focus:outline-none dark:text-zinc-200 dark:hover:border-zinc-700"
                              />
                            </div>
                          ) : (
                            <input
                              value={row[j] ?? ''}
                              onChange={(e) => setCell(i, j, e.target.value)}
                              disabled={disabled}
                              className={cn(
                                'w-full rounded border border-transparent bg-transparent px-2 py-1 text-sm text-zinc-800 transition-colors',
                                'hover:border-zinc-200 focus:border-accent-600 focus:outline-none dark:text-zinc-200 dark:hover:border-zinc-700',
                                c.numeric && 'pb-num text-right',
                                j === 0 && table.breakdown && 'pl-5',
                              )}
                            />
                          )}
                        </td>
                      ))}
                      <td className="px-1 py-1 text-right">
                        <button
                          type="button"
                          onClick={() => applyRows(currentRows.filter((_, k) => k !== i))}
                          className="rounded p-1 text-zinc-400 transition-colors hover:bg-zinc-100 hover:text-red-600 dark:hover:bg-zinc-800"
                          aria-label={'Remove row ' + (i + 1)}
                        >
                          <Trash2 className="h-3 w-3" aria-hidden />
                        </button>
                      </td>
                    </tr>
                    {isOpen && parts ? (
                      <tr className="bg-zinc-50/70 dark:bg-zinc-900/40">
                        <td colSpan={spec.columns.length + 1} className="px-3 py-2">
                          <p className="mb-1 text-[11px] text-zinc-500 dark:text-zinc-400">
                            {`${row[0]} combines ${parts.length} hostnames. These are the figures `
                              + 'Adobe reports individually.'}
                          </p>
                          <ul className="space-y-0.5">
                            {parts.map((p) => (
                              <li key={p} className="pb-num text-[11px] text-zinc-600 dark:text-zinc-300">
                                {p}
                              </li>
                            ))}
                          </ul>
                        </td>
                      </tr>
                    ) : null}
                  </React.Fragment>
                );
              })}
            </tbody>
          </table>
          </div>
          <div className="border-t border-zinc-200 px-3 py-2 dark:border-zinc-800">
            <Button
              size="sm"
              variant="ghost"
              onClick={() => applyRows([...currentRows, spec.columns.map(() => '')])}
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

type ImportState =
  | { status: 'idle' }
  | { status: 'reading' }
  | { status: 'ok'; summary: ImportSummary; fileName: string }
  | { status: 'error'; problems: string[]; fileName: string };

/**
 * File drop target for sections whose source export cannot survive a paste.
 *
 * Drag events fire on every child element, so a naive dragenter/dragleave pair
 * flickers as the pointer crosses the inner text. The depth counter is what
 * keeps the highlight steady.
 */
function DropZone({
  hint, state, disabled, onFile,
}: {
  hint?: string;
  state: ImportState;
  disabled?: boolean;
  onFile: (file: File) => void;
}) {
  const inputRef = React.useRef<HTMLInputElement>(null);
  const depth = React.useRef(0);
  const [over, setOver] = React.useState(false);

  const take = (files: FileList | null) => {
    const file = files?.[0];
    if (file && !disabled) onFile(file);
  };

  return (
    <div>
      <div
        onDragEnter={(e) => {
          e.preventDefault(); depth.current += 1; setOver(true);
        }}
        onDragOver={(e) => e.preventDefault()}
        onDragLeave={(e) => {
          e.preventDefault(); depth.current -= 1;
          if (depth.current <= 0) { depth.current = 0; setOver(false); }
        }}
        onDrop={(e) => {
          e.preventDefault(); depth.current = 0; setOver(false);
          take(e.dataTransfer.files);
        }}
        className={cn(
          'flex flex-col items-center justify-center gap-1 rounded-md border border-dashed px-4 py-6 text-center transition-colors',
          over
            ? 'border-accent-600 bg-accent-600/5'
            : 'border-zinc-300 bg-zinc-50/60 dark:border-zinc-700 dark:bg-zinc-900/40',
          disabled && 'opacity-60',
        )}
      >
        <FileUp className="h-4 w-4 text-zinc-400" aria-hidden />
        <p className="text-xs text-zinc-600 dark:text-zinc-300">
          {state.status === 'reading' ? 'Reading the file…' : (
            <>
              Drop the CSV or Excel file here, or{' '}
              <button
                type="button"
                onClick={() => inputRef.current?.click()}
                disabled={disabled}
                className="font-medium text-accent-700 underline underline-offset-2 hover:text-accent-600 disabled:no-underline dark:text-accent-400"
              >
                choose a file
              </button>
            </>
          )}
        </p>
        {hint ? (
          <p className="max-w-md text-[11px] leading-relaxed text-zinc-500 dark:text-zinc-400">{hint}</p>
        ) : null}
        <input
          ref={inputRef}
          type="file"
          accept=".csv,.tsv,.xlsx,.xlsm,.xlsb,.xls,text/csv,text/plain,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
          className="sr-only"
          disabled={disabled}
          onChange={(e) => { take(e.target.files); e.target.value = ''; }}
        />
      </div>

      {state.status === 'error' ? (
        <div
          role="alert"
          className="mt-2 flex gap-2 rounded-md border border-red-200 bg-red-50 px-3 py-2 dark:border-red-900/50 dark:bg-red-950/30"
        >
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-red-600 dark:text-red-400" aria-hidden />
          <div className="space-y-1">
            <p className="text-xs font-medium text-red-800 dark:text-red-300">
              {state.fileName} could not be imported. The existing rows were left alone.
            </p>
            {state.problems.map((p) => (
              <p key={p} className="text-[11px] leading-relaxed text-red-700 dark:text-red-400">{p}</p>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}

/**
 * What the import did, stated in full.
 *
 * Every figure here is one a reader could otherwise only discover by adding up
 * the table and finding it did not match Adobe. Rows were dropped and traffic
 * was excluded; saying so is cheaper than being asked about it later.
 */
function ImportFooter({
  summary, fileName, updatedAt,
}: {
  summary: ImportSummary;
  fileName: string;
  updatedAt: string | null;
}) {
  const notes: string[] = [];
  if (summary.direct) {
    notes.push(
      `Direct traffic (${summary.direct.subscriptions.toLocaleString()} new subscriptions on `
      + `${summary.direct.visits.toLocaleString()} visits) is held out of the ranking because it `
      + 'is not a referrer.');
  }
  if (summary.ratesWithheld > 0) {
    notes.push(
      `Conversion is shown as — for ${summary.ratesWithheld} platforms that drove fewer than `
      + `${summary.minConversionsForRate} subscriptions. A rate built on one or two conversions `
      + 'is sampling noise, and reads as a real number next to Google.');
  }
  if (summary.zeroSubDomains > 0) {
    notes.push(
      `${summary.zeroSubDomains.toLocaleString()} domains drove no subscriptions `
      + `(${summary.zeroSubVisits.toLocaleString()} visits) and are not listed.`);
  }
  if (summary.unitemisedSubscriptions && summary.unitemisedSubscriptions > 0) {
    notes.push(
      `${summary.unitemisedSubscriptions} subscriptions in Adobe's total row are not attributed `
      + 'to any itemised domain, so the column will not sum to the site total.');
  }
  for (const p of summary.problems) notes.push(p);

  return (
    <div className="space-y-1">
      <span className="pb-num block">
        {describeImport(summary, fileName)
          + (updatedAt ? ' · imported ' + formatRelative(updatedAt) : '')}
      </span>
      {notes.map((n) => (
        <span key={n} className="block text-[11px] leading-relaxed text-zinc-500 dark:text-zinc-400">
          {n}
        </span>
      ))}
    </div>
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
