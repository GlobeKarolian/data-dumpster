'use client';

import * as React from 'react';
import { AlertTriangle, FileImage, Loader2, ShieldCheck, Trash2, Upload } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import type { SearchOcrRow } from '@/lib/reports/search-screenshot-ocr';
import type { ManualSectionSpec, ManualTable } from '@/lib/reports/types';
import { rowsToTsv } from '@/lib/reports/tsv';

const MAX_FILES = 8;
const MAX_FILE_BYTES = 12 * 1024 * 1024;
const ACCEPTED_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);

type ImportState =
  | { status: 'idle' }
  | { status: 'reading'; fileName: string; fileIndex: number; fileCount: number; progress: number }
  | { status: 'review'; rows: SearchOcrRow[]; fileNames: string[]; rejected: string[] }
  | { status: 'error'; message: string };

/** Files are sent as base64 to the reader; nothing is stored server-side. */
async function toBase64(file: File): Promise<{ mediaType: string; base64: string }> {
  const buffer = await file.arrayBuffer();
  const bytes = new Uint8Array(buffer);
  let binary = '';
  const CHUNK = 0x8000; // Avoid blowing the argument limit on large captures.
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return { mediaType: file.type, base64: btoa(binary) };
}

/**
 * Rows reach the report as soon as they are read, not when a button is found.
 *
 * The review grid used to be a required second click: the model returned the
 * right rows, the editor saw them on screen, and the section underneath still
 * said "Nothing imported yet" because nothing had been applied. Data visibly
 * present but silently unsaved is the same failure this whole rewrite was
 * about, moved one step later in the flow. So every read applies immediately
 * and every correction re-applies; `done` only controls whether the panel
 * collapses back to the table view.
 */
export function SearchScreenshotImport({
  spec,
  disabled,
  onApply,
}: {
  spec: ManualSectionSpec;
  disabled?: boolean;
  onApply: (table: ManualTable, opts?: { done?: boolean }) => void;
}) {
  const inputRef = React.useRef<HTMLInputElement>(null);
  const dragDepth = React.useRef(0);
  const [over, setOver] = React.useState(false);
  const [state, setState] = React.useState<ImportState>({ status: 'idle' });

  /** Push the current rows into the report. `done` collapses the panel. */
  const applyRows = (rows: SearchOcrRow[], done?: boolean) => {
    const cells = rows.map((row) => [...row.cells]);
    onApply(
      { raw: rowsToTsv(cells), rows: cells, updatedAt: new Date().toISOString() },
      done ? { done: true } : undefined,
    );
  };

  const readFiles = async (incoming: File[]) => {
    if (disabled) return;
    if (incoming.length === 0) return;
    if (incoming.length > MAX_FILES) {
      setState({ status: 'error', message: `Choose no more than ${MAX_FILES} screenshots at once.` });
      return;
    }
    const badType = incoming.find((file) => !ACCEPTED_TYPES.has(file.type));
    if (badType) {
      setState({ status: 'error', message: `${badType.name} is not a JPEG, PNG, or WebP image.` });
      return;
    }
    const tooLarge = incoming.find((file) => file.size > MAX_FILE_BYTES);
    if (tooLarge) {
      setState({ status: 'error', message: `${tooLarge.name} is larger than 12 MB.` });
      return;
    }

    setState({
      status: 'reading',
      fileName: incoming.length === 1 ? incoming[0].name : `${incoming.length} screenshots`,
      fileIndex: 0,
      fileCount: incoming.length,
      progress: 0,
    });

    try {
      const images = await Promise.all(incoming.map(toBase64));
      /*
       * All captures go in one request. They are pages of a single table, and
       * reading them together lets the model keep the row order across a page
       * break instead of us stitching two independent guesses afterwards.
       */
      const response = await fetch('/api/reports/search-screenshot', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ images }),
      });
      const payload = await response.json().catch(() => null) as {
        rows?: SearchOcrRow[];
        rejected?: string[];
        error?: string;
        message?: string;
      } | null;

      if (!response.ok) {
        setState({
          status: 'error',
          message: payload?.message
            ?? payload?.error
            ?? `The screenshots could not be read (${response.status}).`,
        });
        return;
      }

      const rows = payload?.rows ?? [];
      if (rows.length === 0) {
        setState({
          status: 'error',
          message: 'No Query, URL Clicks, Impressions, and URL CTR rows were found. Crop closer to the table and try again.',
        });
        return;
      }
      setState({
        status: 'review',
        rows,
        fileNames: incoming.map((file) => file.name),
        rejected: payload?.rejected ?? [],
      });
      // Saved the moment they are read. The grid below is for correcting them,
      // not for deciding whether they count.
      applyRows(rows);
    } catch (error) {
      setState({
        status: 'error',
        message: error instanceof Error
          ? `The screenshots could not be read: ${error.message}`
          : 'The screenshots could not be read.',
      });
    }
  };

  const take = (files: FileList | null) => {
    if (!files) return;
    void readFiles(Array.from(files));
  };

  const setCell = (rowIndex: number, cellIndex: number, value: string) => {
    if (state.status !== 'review') return;
    const rows = state.rows.map((row, index) => index === rowIndex
      ? { ...row, cells: row.cells.map((cell, i) => i === cellIndex ? value : cell) as SearchOcrRow['cells'] }
      : row);
    setState({ ...state, rows });
    // A correction that only lives in this panel is the stranded-data bug again.
    applyRows(rows);
  };

  const removeRow = (rowIndex: number) => {
    if (state.status !== 'review') return;
    const rows = state.rows.filter((_, index) => index !== rowIndex);
    setState({ ...state, rows });
    applyRows(rows);
  };

  if (state.status === 'review') {
    // null means the reader does not score rows; only a real number can be low.
    const lowConfidence = state.rows.filter((row) => row.confidence !== null && row.confidence < 70).length;
    return (
      <div className="space-y-3 rounded-md border border-sky-200 bg-sky-50/60 p-3 dark:border-sky-900/60 dark:bg-sky-950/20">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div>
            <p className="text-xs font-semibold text-zinc-900 dark:text-zinc-100">
              Saved {state.rows.length} {state.rows.length === 1 ? 'row' : 'rows'}, review below
            </p>
            <p className="mt-0.5 text-[11px] text-zinc-600 dark:text-zinc-400">
              From {state.fileNames.length} {state.fileNames.length === 1 ? 'image' : 'images'}. Already saved to the section below; edits here save as you make them.
            </p>
          </div>
          <div className="flex gap-2">
            <Button size="sm" variant="ghost" onClick={() => setState({ status: 'idle' })}>
              Choose different images
            </Button>
            <Button
              size="sm"
              variant="primary"
              disabled={disabled || state.rows.length === 0}
              onClick={() => applyRows(state.rows, true)}
            >
              Done, {state.rows.length} {state.rows.length === 1 ? 'row' : 'rows'} saved
            </Button>
          </div>
        </div>
        {lowConfidence > 0 ? (
          <div className="flex gap-2 rounded border border-amber-200 bg-amber-50 px-2.5 py-2 text-[11px] text-amber-900 dark:border-amber-900/60 dark:bg-amber-950/30 dark:text-amber-200">
            <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
            {lowConfidence} {lowConfidence === 1 ? 'row has' : 'rows have'} low OCR confidence. Check the highlighted row before accepting it.
          </div>
        ) : null}
        {/*
          * The whole point of the rewrite. The old parser dropped unreadable
          * rows silently, so a table missing a third of its clicks looked
          * exactly like a complete one. Anything discarded is named here.
          */}
        {state.rejected.length > 0 ? (
          <div className="flex gap-2 rounded border border-amber-200 bg-amber-50 px-2.5 py-2 text-[11px] text-amber-900 dark:border-amber-900/60 dark:bg-amber-950/30 dark:text-amber-200">
            <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
            <span>
              {state.rejected.length} {state.rejected.length === 1 ? 'row was' : 'rows were'} discarded as unreadable
              {' '}({state.rejected.slice(0, 3).join('; ')}
              {state.rejected.length > 3 ? `; and ${state.rejected.length - 3} more` : ''}).
              Compare against the screenshot and add anything missing by hand.
            </span>
          </div>
        ) : null}
        <div className="overflow-x-auto rounded border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-950">
          <table className="w-full min-w-[760px] border-collapse">
            <thead className="border-b border-zinc-200 dark:border-zinc-800">
              <tr>
                {spec.columns.map((column) => (
                  <th key={column.key} className={cn(
                    'px-2 py-2 text-[10px] font-medium uppercase tracking-wider text-zinc-500',
                    column.numeric ? 'text-right' : 'text-left',
                  )}>
                    {column.label}
                  </th>
                ))}
                <th className="w-8" />
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800/70">
              {state.rows.map((row, rowIndex) => (
                <tr key={`${row.source}-${rowIndex}`} className={row.confidence !== null && row.confidence < 70 ? 'bg-amber-50/70 dark:bg-amber-950/20' : undefined}>
                  {spec.columns.map((column, cellIndex) => (
                    <td key={column.key} className="px-1 py-1">
                      <input
                        value={row.cells[cellIndex] ?? ''}
                        onChange={(event) => setCell(rowIndex, cellIndex, event.target.value)}
                        disabled={disabled}
                        aria-label={`${column.label}, extracted row ${rowIndex + 1}`}
                        className={cn(
                          'w-full rounded border border-transparent bg-transparent px-2 py-1 text-xs text-zinc-800 hover:border-zinc-200 focus:border-accent-600 focus:outline-none dark:text-zinc-200 dark:hover:border-zinc-700',
                          column.numeric && 'pb-num text-right',
                        )}
                      />
                    </td>
                  ))}
                  <td className="px-1 text-right">
                    <button
                      type="button"
                      onClick={() => removeRow(rowIndex)}
                      disabled={disabled}
                      aria-label={`Remove extracted row ${rowIndex + 1}`}
                      className="rounded p-1 text-zinc-400 hover:bg-zinc-100 hover:text-red-600 dark:hover:bg-zinc-800"
                    >
                      <Trash2 className="h-3 w-3" aria-hidden />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    );
  }

  return (
    <div>
      <div
        onDragEnter={(event) => {
          event.preventDefault();
          dragDepth.current += 1;
          setOver(true);
        }}
        onDragOver={(event) => event.preventDefault()}
        onDragLeave={(event) => {
          event.preventDefault();
          dragDepth.current -= 1;
          if (dragDepth.current <= 0) {
            dragDepth.current = 0;
            setOver(false);
          }
        }}
        onDrop={(event) => {
          event.preventDefault();
          dragDepth.current = 0;
          setOver(false);
          take(event.dataTransfer.files);
        }}
        className={cn(
          'flex flex-col items-center justify-center gap-1.5 rounded-md border border-dashed px-4 py-6 text-center transition-colors',
          over
            ? 'border-sky-500 bg-sky-50 dark:bg-sky-950/30'
            : 'border-sky-200 bg-sky-50/50 dark:border-sky-900/70 dark:bg-sky-950/20',
          disabled && 'opacity-60',
        )}
      >
        {state.status === 'reading' ? (
          <Loader2 className="h-5 w-5 animate-spin text-sky-600" aria-hidden />
        ) : (
          <FileImage className="h-5 w-5 text-sky-600" aria-hidden />
        )}
        <p className="text-xs font-medium text-zinc-800 dark:text-zinc-200">
          {state.status === 'reading'
            ? `Reading ${state.fileName} (${state.fileIndex + 1} of ${state.fileCount})…`
            : 'Drop Google table screenshots here'}
        </p>
        {state.status === 'reading' ? (
          <div className="mt-1 h-1.5 w-full max-w-xs overflow-hidden rounded-full bg-zinc-200 dark:bg-zinc-800">
            <div
              className="h-full rounded-full bg-sky-600 transition-[width]"
              style={{ width: `${Math.round(state.progress * 100)}%` }}
            />
          </div>
        ) : (
          <>
            <p className="max-w-lg text-[11px] leading-relaxed text-zinc-500 dark:text-zinc-400">
              JPEG, PNG, or WebP · up to {MAX_FILES} images · include the column headers when possible
            </p>
            <Button size="sm" variant="secondary" onClick={() => inputRef.current?.click()} disabled={disabled}>
              <Upload className="h-3.5 w-3.5" aria-hidden />
              Choose screenshots
            </Button>
          </>
        )}
        <input
          ref={inputRef}
          type="file"
          accept="image/jpeg,image/png,image/webp,.jpg,.jpeg,.png,.webp"
          multiple
          className="sr-only"
          disabled={disabled || state.status === 'reading'}
          onChange={(event) => {
            take(event.target.files);
            event.target.value = '';
          }}
        />
      </div>
      <div className="mt-2 flex items-start gap-1.5 text-[10px] leading-relaxed text-zinc-500 dark:text-zinc-400">
        <ShieldCheck className="mt-0.5 h-3 w-3 shrink-0" aria-hidden />
        The screenshot is sent to the AI model configured for this workspace, which reads the table directly. It is used for that one request and is never stored. Extracted rows are not saved until you accept the review table.
      </div>
      {state.status === 'error' ? (
        <div role="alert" className="mt-2 flex gap-2 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-800 dark:border-red-900/50 dark:bg-red-950/30 dark:text-red-300">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
          <div>
            <p>{state.message}</p>
            <button type="button" className="mt-1 font-medium underline underline-offset-2" onClick={() => setState({ status: 'idle' })}>
              Try again
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
