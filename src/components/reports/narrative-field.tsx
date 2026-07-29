'use client';

import * as React from 'react';
import { Loader2, Sparkles } from 'lucide-react';
import { Button } from '@/components/ui/button';
import type { NarrativeSectionSpec } from '@/lib/reports/types';

/**
 * The so-what field.
 *
 * The chief executive's standing instruction on this report is that it answers
 * so-what and never ships a naked table, so this is not an optional notes box
 * at the bottom -- there is one per section and it sits above the data.
 *
 * The AI draft never overwrites work in place. If the field is empty the draft
 * lands in it; if the author has already written something the draft appears
 * beside it and has to be accepted. A model is a first draft here, not an
 * editor.
 */
export function NarrativeField({
  spec,
  reportId,
  value,
  onChange,
  disabled,
}: {
  spec: NarrativeSectionSpec;
  reportId: string;
  value: string;
  onChange: (next: string) => void;
  disabled?: boolean;
}) {
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [draft, setDraft] = React.useState<string | null>(null);

  const requestDraft = async () => {
    setBusy(true);
    setError(null);
    setDraft(null);
    try {
      const res = await fetch('/api/reports/' + reportId + '/narrative', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ sectionId: spec.id, save: false }),
      });
      const payload: unknown = await res.json().catch(() => null);
      if (!res.ok) {
        const message = typeof payload === 'object' && payload !== null && 'error' in payload
          ? String((payload as { error: unknown }).error)
          : 'The draft request failed with status ' + res.status + '.';
        throw new Error(message);
      }
      const text = typeof payload === 'object' && payload !== null && 'text' in payload
        ? String((payload as { text: unknown }).text)
        : '';
      if (!text.trim()) throw new Error('The model returned an empty draft.');
      if (value.trim()) setDraft(text);
      else onChange(text);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not draft this section.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <label
          htmlFor={'narrative-' + spec.id}
          className="text-[11px] font-medium uppercase tracking-wider text-zinc-500 dark:text-zinc-400"
        >
          Narrative
        </label>
        <Button size="sm" variant="ghost" onClick={requestDraft} disabled={busy || disabled}>
          {busy
            ? <Loader2 className="h-3 w-3 animate-spin" aria-hidden />
            : <Sparkles className="h-3 w-3" aria-hidden />}
          {busy ? 'Drafting' : 'AI draft'}
        </Button>
      </div>

      <textarea
        id={'narrative-' + spec.id}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        disabled={disabled}
        rows={4}
        placeholder={spec.guidance}
        className="w-full rounded-md border border-zinc-200 bg-white px-3 py-2 text-sm leading-relaxed text-zinc-900 placeholder:text-zinc-400 transition-colors focus:border-accent-600 focus:outline-none dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-100 dark:placeholder:text-zinc-600"
      />

      {error ? (
        <p className="text-[11px] leading-relaxed text-red-600 dark:text-red-400">{error}</p>
      ) : null}

      {draft ? (
        <div className="rounded-md border border-accent-600/30 bg-accent-600/5 p-3 dark:border-accent-600/40 dark:bg-accent-600/10">
          <p className="text-[11px] font-medium uppercase tracking-wider text-accent-700 dark:text-accent-400">
            Suggested draft
          </p>
          <p className="mt-1.5 text-sm leading-relaxed text-zinc-700 dark:text-zinc-300">{draft}</p>
          <div className="mt-2 flex items-center gap-2">
            <Button size="sm" variant="primary" onClick={() => { onChange(draft); setDraft(null); }}>
              Replace
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => { onChange((value.trim() + '\n\n' + draft).trim()); setDraft(null); }}
            >
              Append
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setDraft(null)}>
              Discard
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
