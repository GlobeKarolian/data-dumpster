'use client';

import * as React from 'react';
import { Loader2, PanelLeftClose, PanelLeft, Send } from 'lucide-react';
import type { FactSheet } from '@/lib/metrics/contract';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/input';
import { Markdown } from '@/components/briefs/markdown';
import { FactSheetPanel } from './fact-sheet-panel';

interface Turn {
  id: string;
  role: 'user' | 'assistant';
  content: string;
}

const SUGGESTIONS = [
  'Who gained the most engagement rate this window, and is the change big enough to matter?',
  'Where are we losing ground against the competitive average?',
  'Which channel is the weakest link for the focus company right now?',
  'What did the top competitor post that we did not?',
];

export interface AskChatProps {
  landscapeId: string;
  landscapeName: string;
  start: string;
  end: string;
  facts: FactSheet | null;
}

/**
 * Ask.
 *
 * The assistant is given a pre-computed fact sheet and nothing else — no
 * database access, no tools, no browsing. It can only restate what is in the
 * panel on the right. That is a deliberate ceiling on what it can say, and it
 * is the reason its answers can be put in front of an editor.
 */
export function AskChat({ landscapeId, landscapeName, start, end, facts }: AskChatProps) {
  const [turns, setTurns] = React.useState<Turn[]>([]);
  const [draft, setDraft] = React.useState('');
  const [streaming, setStreaming] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [panelOpen, setPanelOpen] = React.useState(true);
  const endRef = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [turns]);

  const ask = async (question: string) => {
    const trimmed = question.trim();
    if (!trimmed || streaming) return;

    const userTurn: Turn = { id: 'u' + Date.now(), role: 'user', content: trimmed };
    const assistantId = 'a' + Date.now();
    setTurns((prev) => [...prev, userTurn, { id: assistantId, role: 'assistant', content: '' }]);
    setDraft('');
    setStreaming(true);
    setError(null);

    try {
      const res = await fetch('/api/ai/ask', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          landscapeId,
          start,
          end,
          question: trimmed,
          history: turns.map((t) => ({ role: t.role, content: t.content })),
        }),
      });

      if (!res.ok || !res.body) {
        const detail = res.body ? await res.text() : '';
        throw new Error(detail.slice(0, 300) || 'The assistant returned ' + res.status + '.');
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let accumulated = '';
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        accumulated += decoder.decode(value, { stream: true });
        setTurns((prev) =>
          prev.map((t) => (t.id === assistantId ? { ...t, content: accumulated } : t)),
        );
      }
      if (accumulated.trim() === '') {
        setTurns((prev) =>
          prev.map((t) =>
            t.id === assistantId
              ? { ...t, content: 'The model returned an empty answer. Nothing was inferred to fill the gap.' }
              : t,
          ),
        );
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not reach the assistant.');
      setTurns((prev) => prev.filter((t) => t.id !== assistantId));
    } finally {
      setStreaming(false);
    }
  };

  return (
    <div className="flex gap-4">
      <div className="flex min-w-0 flex-1 flex-col">
        <div className="min-h-[24rem] flex-1 space-y-4">
          {turns.length === 0 ? (
            <div className="rounded-lg border border-dashed border-zinc-200 p-6 dark:border-zinc-800">
              <h3 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
                {'Ask about ' + landscapeName}
              </h3>
              <p className="mt-1 max-w-xl text-xs leading-relaxed text-zinc-500 dark:text-zinc-400">
                The assistant can only use the fact sheet in the side panel. It cannot query, browse,
                or estimate. If the answer is not in that sheet, it will tell you so rather than
                invent a figure.
              </p>
              <ul className="mt-4 grid gap-2 sm:grid-cols-2">
                {SUGGESTIONS.map((s) => (
                  <li key={s}>
                    <button
                      type="button"
                      onClick={() => ask(s)}
                      className="w-full rounded-md border border-zinc-200 px-3 py-2 text-left text-xs leading-relaxed text-zinc-600 transition-colors hover:border-accent-600 hover:text-zinc-900 dark:border-zinc-800 dark:text-zinc-400 dark:hover:text-zinc-100"
                    >
                      {s}
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          ) : (
            turns.map((t) =>
              t.role === 'user' ? (
                <div key={t.id} className="flex justify-end">
                  <p className="max-w-lg rounded-lg rounded-br-sm bg-accent-600 px-3 py-2 text-sm leading-relaxed text-white">
                    {t.content}
                  </p>
                </div>
              ) : (
                <div
                  key={t.id}
                  className="rounded-lg border border-zinc-200 bg-white px-4 py-3 dark:border-zinc-800 dark:bg-zinc-900/40"
                >
                  {t.content ? (
                    <Markdown source={t.content} />
                  ) : (
                    <p className="flex items-center gap-2 text-xs text-zinc-500">
                      <Loader2 className="h-3 w-3 animate-spin" aria-hidden />
                      Reading the fact sheet
                    </p>
                  )}
                </div>
              ),
            )
          )}
          <div ref={endRef} />
        </div>

        {error ? (
          <p className="mt-3 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs leading-relaxed text-red-700 dark:border-red-900/50 dark:bg-red-950/30 dark:text-red-400">
            {error}
          </p>
        ) : null}

        <form
          onSubmit={(e) => {
            e.preventDefault();
            ask(draft);
          }}
          className="sticky bottom-4 mt-4"
        >
          <div className="rounded-lg border border-zinc-200 bg-white p-2 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
            <Textarea
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                  e.preventDefault();
                  ask(draft);
                }
              }}
              rows={2}
              placeholder="Ask about this landscape and window"
              aria-label="Your question"
              className="border-0 bg-transparent px-1 focus:border-0 dark:bg-transparent"
            />
            <div className="mt-1 flex items-center justify-between gap-2">
              <p className="text-[10px] text-zinc-400">Command-Enter to send</p>
              <Button type="submit" variant="primary" size="sm" disabled={streaming || !draft.trim()}>
                {streaming ? (
                  <Loader2 className="h-3 w-3 animate-spin" aria-hidden />
                ) : (
                  <Send className="h-3 w-3" aria-hidden />
                )}
                Ask
              </Button>
            </div>
          </div>
        </form>
      </div>

      <aside className={cn('shrink-0 transition-[width]', panelOpen ? 'w-80' : 'w-10')}>
        <button
          type="button"
          onClick={() => setPanelOpen((v) => !v)}
          aria-expanded={panelOpen}
          className="mb-2 inline-flex h-7 items-center gap-1.5 rounded-md px-2 text-[11px] font-medium text-zinc-500 transition-colors hover:bg-zinc-100 hover:text-zinc-900 dark:hover:bg-zinc-800 dark:hover:text-zinc-100"
        >
          {panelOpen ? (
            <PanelLeftClose className="h-3.5 w-3.5 rotate-180" aria-hidden />
          ) : (
            <PanelLeft className="h-3.5 w-3.5 rotate-180" aria-hidden />
          )}
          {panelOpen ? 'Hide fact sheet' : ''}
        </button>
        {panelOpen ? (
          <div className="lg:sticky lg:top-20">
            <FactSheetPanel facts={facts} />
          </div>
        ) : null}
      </aside>
    </div>
  );
}
