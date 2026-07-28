'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { Loader2, Sparkles } from 'lucide-react';
import { Button } from '@/components/ui/button';

/**
 * Generation runs on the org's own model connection. If none is configured the
 * request fails, and the failure says so rather than silently falling back to
 * somebody else's inference.
 */
export function GenerateBriefButton({
  landscapeId,
  start,
  end,
}: {
  landscapeId: string;
  start: string;
  end: string;
}) {
  const router = useRouter();
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const generate = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch('/api/ai/brief', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ landscapeId, start, end }),
      });
      if (!res.ok) {
        const detail = await res.text();
        throw new Error(detail.slice(0, 300) || 'Generation failed with status ' + res.status + '.');
      }
      const created = (await res.json()) as { id?: string };
      if (created.id) router.push('/briefs/' + created.id);
      else router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not generate a brief.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col items-end gap-1">
      <Button variant="primary" size="sm" onClick={generate} disabled={busy}>
        {busy ? (
          <Loader2 className="h-3 w-3 animate-spin" aria-hidden />
        ) : (
          <Sparkles className="h-3 w-3" aria-hidden />
        )}
        {busy ? 'Writing brief' : 'Generate brief'}
      </Button>
      {error ? (
        <p className="max-w-xs text-right text-[11px] leading-relaxed text-red-600 dark:text-red-400">
          {error}
        </p>
      ) : null}
    </div>
  );
}
