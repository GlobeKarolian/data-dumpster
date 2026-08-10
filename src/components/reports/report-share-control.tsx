'use client';

import * as React from 'react';
import { Check, Copy, ExternalLink, Link2, Loader2, Unlink } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { absoluteShareUrl } from '@/components/dashboards/share-url';

export function ReportShareControl({
  reportId,
  initialShareUrl,
}: {
  reportId: string;
  initialShareUrl: string | null;
}) {
  const [shareUrl, setShareUrl] = React.useState(initialShareUrl);
  const [busy, setBusy] = React.useState(false);
  const [copied, setCopied] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const update = async (enabled: boolean) => {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch('/api/reports/' + reportId + '/share', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ enabled }),
      });
      const payload: unknown = await response.json().catch(() => null);
      if (!response.ok) {
        throw new Error(
          typeof payload === 'object' && payload !== null && 'error' in payload
            ? String((payload as { error: unknown }).error)
            : 'The public link could not be updated.',
        );
      }
      setShareUrl(
        typeof payload === 'object' && payload !== null && 'shareUrl' in payload
          && typeof (payload as { shareUrl: unknown }).shareUrl === 'string'
          ? (payload as { shareUrl: string }).shareUrl
          : null,
      );
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'The public link could not be updated.');
    } finally {
      setBusy(false);
    }
  };

  if (!shareUrl) {
    return (
      <div className="flex flex-wrap items-center justify-end gap-2">
        {error ? <span className="text-[11px] text-red-600">{error}</span> : null}
        <Button size="sm" variant="secondary" disabled={busy} onClick={() => { void update(true); }}>
          {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> : <Link2 className="h-3.5 w-3.5" aria-hidden />}
          Create public link
        </Button>
      </div>
    );
  }

  const absolute = typeof window === 'undefined'
    ? shareUrl
    : absoluteShareUrl(shareUrl, window.location.origin);
  return (
    <div className="flex max-w-full flex-wrap items-center justify-end gap-2">
      <span className="hidden max-w-60 truncate rounded bg-zinc-100 px-2 py-1 text-[10px] text-zinc-500 lg:block dark:bg-zinc-800">
        Anyone with this link can view the report
      </span>
      <Button
        size="sm"
        variant="secondary"
        onClick={async () => {
          try {
            await navigator.clipboard.writeText(absolute);
            setCopied(true);
            window.setTimeout(() => setCopied(false), 1_600);
          } catch {
            setCopied(false);
          }
        }}
      >
        {copied ? <Check className="h-3.5 w-3.5" aria-hidden /> : <Copy className="h-3.5 w-3.5" aria-hidden />}
        {copied ? 'Copied' : 'Copy public link'}
      </Button>
      <Button
        size="icon"
        variant="ghost"
        aria-label="Open public report"
        onClick={() => window.open(absolute, '_blank', 'noopener,noreferrer')}
      >
        <ExternalLink className="h-3.5 w-3.5" aria-hidden />
      </Button>
      <Button size="icon" variant="ghost" aria-label="Revoke public report link" disabled={busy} onClick={() => { void update(false); }}>
        {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> : <Unlink className="h-3.5 w-3.5" aria-hidden />}
      </Button>
      {error ? <span className="w-full text-right text-[11px] text-red-600">{error}</span> : null}
    </div>
  );
}
