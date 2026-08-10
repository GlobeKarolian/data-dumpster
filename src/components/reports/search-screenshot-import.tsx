'use client';

import * as React from 'react';
import { AlertTriangle, FileImage, Loader2, ShieldCheck, Trash2, Upload } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import {
  mergeSearchOcrRows,
  searchRowsFromTsv,
  type SearchOcrRow,
} from '@/lib/reports/search-screenshot-ocr';
import type { ManualSectionSpec, ManualTable } from '@/lib/reports/types';
import { rowsToTsv } from '@/lib/reports/tsv';

const MAX_FILES = 8;
const MAX_FILE_BYTES = 12 * 1024 * 1024;
const ACCEPTED_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);

type ImportState =
  | { status: 'idle' }
  | { status: 'reading'; fileName: string; fileIndex: number; fileCount: number; progress: number }
  | { status: 'review'; rows: SearchOcrRow[]; fileNames: string[] }
  | { status: 'error'; message: string };

export function SearchScreenshotImport({
  spec,
  disabled,
  onApply,
}: {
  spec: ManualSectionSpec;
  disabled?: boolean;
  onApply: (table: ManualTable) => void;
}) {
  const inputRef = React.useRef<HTMLInputElement>(null);
  const dragDepth = React.useRef(0);
  const [over, setOver] = React.useState(false);
  const [state, setState] = React.useState<ImportState>({ status: 'idle' });

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

    let activeIndex = 0;
    setState({
      status: 'reading',
      fileName: incoming[0].name,
      fileIndex: 0,
      fileCount: incoming.length,
      progress: 0,
    });

    let worker: Awaited<ReturnType<typeof import('tesseract.js')['createWorker']>> | null = null;
    try {
      const { createWorker, OEM, PSM } = await import('tesseract.js');
      worker = await createWorker('eng', OEM.LSTM_ONLY, {
        workerPath: '/ocr/worker.min.js',
        corePath: '/ocr/tesseract-core-lstm.wasm.js',
        langPath: '/ocr',
        logger: (message) => {
          const progress = Number.isFinite(message.progress) ? message.progress : 0;
          setState({
            status: 'reading',
            fileName: incoming[activeIndex]?.name ?? 'screenshot',
            fileIndex: activeIndex,
            fileCount: incoming.length,
            progress: Math.max(0, Math.min(1, (activeIndex + progress) / incoming.length)),
          });
        },
      });
      await worker.setParameters({
        tessedit_pageseg_mode: PSM.AUTO,
        preserve_interword_spaces: '1',
        user_defined_dpi: '200',
      });

      const groups: SearchOcrRow[][] = [];
      for (activeIndex = 0; activeIndex < incoming.length; activeIndex += 1) {
        const file = incoming[activeIndex];
        setState({
          status: 'reading',
          fileName: file.name,
          fileIndex: activeIndex,
          fileCount: incoming.length,
          progress: activeIndex / incoming.length,
        });
        const result = await worker.recognize(file, {}, { text: true, tsv: true });
        groups.push(searchRowsFromTsv(result.data.tsv ?? '', file.name));
      }

      const rows = mergeSearchOcrRows(groups);
      if (rows.length === 0) {
        setState({
          status: 'error',
          message: 'No complete Search Query, URL Clicks, Impressions, CTR, and Avg Position rows were found. Crop closer to the table and try again.',
        });
        return;
      }
      setState({ status: 'review', rows, fileNames: incoming.map((file) => file.name) });
    } catch (error) {
      setState({
        status: 'error',
        message: error instanceof Error
          ? `The screenshots could not be read: ${error.message}`
          : 'The screenshots could not be read.',
      });
    } finally {
      await worker?.terminate().catch(() => undefined);
    }
  };

  const take = (files: FileList | null) => {
    if (!files) return;
    void readFiles(Array.from(files));
  };

  const setCell = (rowIndex: number, cellIndex: number, value: string) => {
    if (state.status !== 'review') return;
    setState({
      ...state,
      rows: state.rows.map((row, index) => index === rowIndex
        ? { ...row, cells: row.cells.map((cell, i) => i === cellIndex ? value : cell) as SearchOcrRow['cells'] }
        : row),
    });
  };

  const removeRow = (rowIndex: number) => {
    if (state.status !== 'review') return;
    setState({ ...state, rows: state.rows.filter((_, index) => index !== rowIndex) });
  };

  if (state.status === 'review') {
    const lowConfidence = state.rows.filter((row) => row.confidence < 70).length;
    return (
      <div className="space-y-3 rounded-md border border-sky-200 bg-sky-50/60 p-3 dark:border-sky-900/60 dark:bg-sky-950/20">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div>
            <p className="text-xs font-semibold text-zinc-900 dark:text-zinc-100">
              Review {state.rows.length} extracted {state.rows.length === 1 ? 'row' : 'rows'}
            </p>
            <p className="mt-0.5 text-[11px] text-zinc-600 dark:text-zinc-400">
              From {state.fileNames.length} {state.fileNames.length === 1 ? 'image' : 'images'}. Correct any OCR mistakes before using these rows.
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
              onClick={() => {
                const rows = state.rows.map((row) => [...row.cells]);
                onApply({ raw: rowsToTsv(rows), rows, updatedAt: new Date().toISOString() });
              }}
            >
              Use {state.rows.length} {state.rows.length === 1 ? 'row' : 'rows'}
            </Button>
          </div>
        </div>
        {lowConfidence > 0 ? (
          <div className="flex gap-2 rounded border border-amber-200 bg-amber-50 px-2.5 py-2 text-[11px] text-amber-900 dark:border-amber-900/60 dark:bg-amber-950/30 dark:text-amber-200">
            <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
            {lowConfidence} {lowConfidence === 1 ? 'row has' : 'rows have'} low OCR confidence. Check the highlighted row before accepting it.
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
                <tr key={`${row.source}-${rowIndex}`} className={row.confidence < 70 ? 'bg-amber-50/70 dark:bg-amber-950/20' : undefined}>
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
              JPEG, PNG, or WebP · up to {MAX_FILES} images · include the five column headers when possible
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
        OCR runs in this browser. The screenshots are not uploaded or stored. Extracted rows are not saved until you accept the review table.
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
