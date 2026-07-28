'use client';

import * as React from 'react';
import Link from 'next/link';
import { Download, FileDown, Link2, Sparkles } from 'lucide-react';
import { Popover, PopoverTriggerSurface } from '@/components/ui/popover';
import { useUrlState } from '@/components/common/use-url-state';
import { apiUrl } from '@/components/common/api-params';

export interface ExportTarget {
  label: string;
  /** API route that returns a CSV for the current filters. */
  href: string;
  description: string;
}

/**
 * Export is a first-class action in a competitive tool, because most of what
 * gets seen here ends up in a deck by Thursday. Everything exported carries the
 * same filters that are on screen, so the file and the link agree.
 */
export function ExportMenu({
  targets,
  landscapeId,
}: {
  targets: ExportTarget[];
  landscapeId: string | null;
}) {
  const { searchParams } = useUrlState();
  const [copied, setCopied] = React.useState(false);

  const withParams = (href: string) =>
    landscapeId ? apiUrl(href, searchParams, landscapeId) : href;

  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(window.location.href);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1800);
    } catch {
      setCopied(false);
    }
  };

  return (
    <Popover
      label="Export"
      align="end"
      className="w-auto"
      panelClassName="w-72"
      trigger={({ open }) => (
        <PopoverTriggerSurface open={open} className="w-auto whitespace-nowrap">
          <Download className="h-3.5 w-3.5 shrink-0 text-zinc-400" aria-hidden />
          <span className="text-xs">Export</span>
        </PopoverTriggerSurface>
      )}
    >
      {({ close }) => (
        <div className="p-1">
          {landscapeId === null ? (
            <p className="px-2 py-3 text-[11px] leading-relaxed text-zinc-500">
              Exports need a landscape. Create one under Companies first.
            </p>
          ) : null}
          {targets.map((t) => (
            <a
              key={t.href}
              href={withParams(t.href)}
              onClick={close}
              aria-disabled={landscapeId === null}
              className="flex items-start gap-2 rounded px-2 py-2 transition-colors hover:bg-zinc-100 aria-disabled:pointer-events-none aria-disabled:opacity-40 dark:hover:bg-zinc-800"
            >
              <FileDown className="mt-0.5 h-3.5 w-3.5 shrink-0 text-zinc-400" aria-hidden />
              <span className="min-w-0">
                <span className="block text-xs font-medium text-zinc-900 dark:text-zinc-100">{t.label}</span>
                <span className="block text-[11px] leading-relaxed text-zinc-500">{t.description}</span>
              </span>
            </a>
          ))}
          <button
            type="button"
            onClick={copyLink}
            className="flex w-full items-start gap-2 rounded px-2 py-2 text-left transition-colors hover:bg-zinc-100 dark:hover:bg-zinc-800"
          >
            <Link2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-zinc-400" aria-hidden />
            <span className="min-w-0">
              <span className="block text-xs font-medium text-zinc-900 dark:text-zinc-100">
                {copied ? 'Link copied' : 'Copy view link'}
              </span>
              <span className="block text-[11px] leading-relaxed text-zinc-500">
                Carries the landscape, window and filters exactly as they are now.
              </span>
            </span>
          </button>
          <Link
            href="/briefs"
            onClick={close}
            className="flex items-start gap-2 rounded px-2 py-2 transition-colors hover:bg-zinc-100 dark:hover:bg-zinc-800"
          >
            <Sparkles className="mt-0.5 h-3.5 w-3.5 shrink-0 text-zinc-400" aria-hidden />
            <span className="min-w-0">
              <span className="block text-xs font-medium text-zinc-900 dark:text-zinc-100">
                Generate a written brief
              </span>
              <span className="block text-[11px] leading-relaxed text-zinc-500">
                Prose over the same numbers, with every claim verified.
              </span>
            </span>
          </Link>
        </div>
      )}
    </Popover>
  );
}
