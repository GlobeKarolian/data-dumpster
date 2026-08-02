'use client';

import * as React from 'react';
import {
  Check,
  ClipboardCopy,
  Download,
  FileSpreadsheet,
  Loader2,
  Presentation,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { renderReportHtml, renderReportMarkdown, type ReportDocument } from '@/lib/reports/render';
import { assertReportNarrativeVerified } from '@/lib/reports/narrative-verification';

/**
 * How the artefact actually gets delivered.
 *
 * The weekly goes out as a Google Doc, so the copy action puts real HTML on the
 * clipboard rather than markdown or plain text. Google Docs reads the text/html
 * flavour of a clipboard payload and rebuilds tables, headings and bold from it;
 * given text/plain it would paste a wall of tab characters. Both flavours are
 * written, so pasting into a terminal or a plain-text field still works.
 *
 * The execCommand path is kept for browsers and insecure origins where the
 * async clipboard API is unavailable. It is deprecated and it is also the only
 * thing that works there, which is the whole argument.
 */
function copyRich(html: string, plain: string): Promise<void> {
  const canUseAsync = typeof ClipboardItem !== 'undefined'
    && typeof navigator !== 'undefined'
    && Boolean(navigator.clipboard?.write);

  if (canUseAsync) {
    return navigator.clipboard.write([
      new ClipboardItem({
        'text/html': new Blob([html], { type: 'text/html' }),
        'text/plain': new Blob([plain], { type: 'text/plain' }),
      }),
    ]);
  }

  return new Promise((resolve, reject) => {
    const holder = document.createElement('div');
    holder.setAttribute('contenteditable', 'true');
    holder.style.position = 'fixed';
    holder.style.opacity = '0';
    holder.style.pointerEvents = 'none';
    holder.innerHTML = html;
    document.body.appendChild(holder);
    try {
      const range = document.createRange();
      range.selectNodeContents(holder);
      const selection = window.getSelection();
      selection?.removeAllRanges();
      selection?.addRange(range);
      const ok = document.execCommand('copy');
      selection?.removeAllRanges();
      if (ok) resolve();
      else reject(new Error('The browser refused the copy.'));
    } catch (err) {
      reject(err instanceof Error ? err : new Error('The browser refused the copy.'));
    } finally {
      document.body.removeChild(holder);
    }
  });
}

type ServerFormat = 'pptx' | 'csv';

function filenameFromDisposition(value: string | null, fallback: string): string {
  if (!value) return fallback;
  const utf8 = value.match(/filename\*=UTF-8''([^;]+)/i)?.[1];
  if (utf8) {
    try { return decodeURIComponent(utf8); } catch { return utf8; }
  }
  return value.match(/filename="?([^";]+)"?/i)?.[1] ?? fallback;
}

export function ExportActions({
  doc,
  reportId,
  beforeServerExport,
}: {
  doc: ReportDocument;
  reportId: string;
  beforeServerExport?: () => Promise<boolean>;
}) {
  const [copied, setCopied] = React.useState<'docs' | 'markdown' | null>(null);
  const [downloading, setDownloading] = React.useState<ServerFormat | null>(null);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(null), 2200);
    return () => clearTimeout(timer);
  }, [copied]);

  const copyForDocs = async () => {
    setError(null);
    try {
      assertReportNarrativeVerified(doc);
      await copyRich(renderReportHtml(doc), renderReportMarkdown(doc));
      setCopied('docs');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not write to the clipboard.');
    }
  };

  const copyMarkdown = async () => {
    setError(null);
    try {
      assertReportNarrativeVerified(doc);
      await navigator.clipboard.writeText(renderReportMarkdown(doc));
      setCopied('markdown');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not write to the clipboard.');
    }
  };

  const downloadMarkdown = () => {
    setError(null);
    try {
      assertReportNarrativeVerified(doc);
      const blob = new Blob(
        [renderReportMarkdown(doc)],
        { type: 'text/markdown;charset=utf-8' },
      );
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = 'platforms-digest-' + doc.period.start + '-to-' + doc.period.end + '.md';
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'The report could not be exported.');
    }
  };

  const downloadServerExport = async (format: ServerFormat) => {
    setError(null);
    setDownloading(format);
    try {
      if (beforeServerExport && !(await beforeServerExport())) {
        throw new Error('Save the report successfully before exporting it.');
      }
      const response = await fetch(
        '/api/reports/' + encodeURIComponent(reportId) + '/export?format=' + format,
      );
      if (!response.ok) {
        const payload: unknown = await response.json().catch(() => null);
        const message = typeof payload === 'object' && payload !== null && 'error' in payload
          ? String((payload as { error: unknown }).error)
          : 'Export failed with status ' + response.status + '.';
        throw new Error(message);
      }
      const blob = await response.blob();
      const fallback = 'data-dumpster-report-' + doc.period.start + '-to-'
        + doc.period.end + '.' + format;
      const filename = filenameFromDisposition(
        response.headers.get('content-disposition'),
        fallback,
      );
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = filename;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'The report could not be exported.');
    } finally {
      setDownloading(null);
    }
  };

  return (
    <div className="flex flex-wrap items-center justify-end gap-2">
      <Button size="sm" variant="primary" onClick={copyForDocs}>
        {copied === 'docs'
          ? <Check className="h-3 w-3" aria-hidden />
          : <ClipboardCopy className="h-3 w-3" aria-hidden />}
        {copied === 'docs' ? 'Copied, paste into the doc' : 'Copy for Google Docs'}
      </Button>
      <Button size="sm" variant="secondary" onClick={copyMarkdown}>
        {copied === 'markdown'
          ? <Check className="h-3 w-3" aria-hidden />
          : <ClipboardCopy className="h-3 w-3" aria-hidden />}
        {copied === 'markdown' ? 'Copied' : 'Copy Markdown'}
      </Button>
      <Button
        size="sm"
        variant="secondary"
        onClick={() => { void downloadServerExport('pptx'); }}
        disabled={downloading !== null}
      >
        {downloading === 'pptx'
          ? <Loader2 className="h-3 w-3 animate-spin" aria-hidden />
          : <Presentation className="h-3 w-3" aria-hidden />}
        PowerPoint
      </Button>
      <Button
        size="sm"
        variant="secondary"
        onClick={() => { void downloadServerExport('csv'); }}
        disabled={downloading !== null}
      >
        {downloading === 'csv'
          ? <Loader2 className="h-3 w-3 animate-spin" aria-hidden />
          : <FileSpreadsheet className="h-3 w-3" aria-hidden />}
        CSV
      </Button>
      <Button size="sm" variant="ghost" onClick={downloadMarkdown}>
        <Download className="h-3 w-3" aria-hidden />
        Markdown
      </Button>
      {error ? (
        <span className="w-full text-right text-[11px] text-red-600 dark:text-red-400">{error}</span>
      ) : null}
    </div>
  );
}
