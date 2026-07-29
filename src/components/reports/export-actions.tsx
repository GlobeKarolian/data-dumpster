'use client';

import * as React from 'react';
import { Check, ClipboardCopy, Download } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { renderReportHtml, renderReportMarkdown, type ReportDocument } from '@/lib/reports/render';

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

export function ExportActions({ doc }: { doc: ReportDocument }) {
  const [copied, setCopied] = React.useState<'docs' | 'markdown' | null>(null);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(null), 2200);
    return () => clearTimeout(timer);
  }, [copied]);

  const copyForDocs = async () => {
    setError(null);
    try {
      await copyRich(renderReportHtml(doc), renderReportMarkdown(doc));
      setCopied('docs');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not write to the clipboard.');
    }
  };

  const copyMarkdown = async () => {
    setError(null);
    try {
      await navigator.clipboard.writeText(renderReportMarkdown(doc));
      setCopied('markdown');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not write to the clipboard.');
    }
  };

  const downloadMarkdown = () => {
    const blob = new Blob([renderReportMarkdown(doc)], { type: 'text/markdown;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'platforms-digest-' + doc.period.start + '-to-' + doc.period.end + '.md';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
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
      <Button size="sm" variant="ghost" onClick={downloadMarkdown}>
        <Download className="h-3 w-3" aria-hidden />
        Download
      </Button>
      {error ? (
        <span className="w-full text-right text-[11px] text-red-600 dark:text-red-400">{error}</span>
      ) : null}
    </div>
  );
}
