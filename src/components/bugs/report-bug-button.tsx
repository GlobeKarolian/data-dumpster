'use client';

import * as React from 'react';
import { usePathname, useSearchParams } from 'next/navigation';
import { Bug, CheckCircle2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Dialog } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Field, FieldError, Textarea } from '@/components/ui/input';
import { installConsoleBuffer, recentConsoleErrors } from './console-buffer';

/**
 * "Report a bug", available on every screen from the sidebar footer.
 *
 * The reporter writes what went wrong in their own words. Everything an
 * engineer would otherwise have to ask for (the page, the filters, the
 * landscape, the screen size, recent browser errors) is attached for them,
 * and the dialog says so, so nobody wonders what was sent.
 */
export function ReportBugButton({
  compact,
  landscapeId,
}: {
  compact: boolean;
  landscapeId: string | null;
}) {
  const [open, setOpen] = React.useState(false);
  React.useEffect(() => installConsoleBuffer(), []);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={cn(
          'flex h-7 w-full items-center gap-2.5 rounded-md px-2 text-[13px] text-zinc-500 transition-colors',
          'hover:bg-zinc-50 hover:text-zinc-900 dark:hover:bg-zinc-900 dark:hover:text-zinc-100',
          compact && 'justify-center px-0',
        )}
      >
        <Bug className="h-3.5 w-3.5" strokeWidth={1.75} aria-hidden />
        <span className={compact ? 'sr-only' : undefined}>Report a bug</span>
      </button>
      {open ? <ReportBugDialog onClose={() => setOpen(false)} landscapeId={landscapeId} /> : null}
    </>
  );
}

type Phase =
  | { kind: 'editing' }
  | { kind: 'sending' }
  | { kind: 'sent'; ref: string }
  | { kind: 'failed'; message: string };

function ReportBugDialog({ onClose, landscapeId }: { onClose: () => void; landscapeId: string | null }) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [description, setDescription] = React.useState('');
  const [expected, setExpected] = React.useState('');
  const [phase, setPhase] = React.useState<Phase>({ kind: 'editing' });
  const errorsAtOpen = React.useMemo(() => recentConsoleErrors(), []);

  const filters = React.useMemo(() => {
    const out: Record<string, string> = {};
    searchParams.forEach((value, key) => {
      out[key] = value.slice(0, 500);
    });
    return out;
  }, [searchParams]);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (description.trim().length < 3) {
      setPhase({ kind: 'failed', message: 'Say what went wrong first.' });
      return;
    }
    setPhase({ kind: 'sending' });
    try {
      const res = await fetch('/api/bug-reports', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          description: description.trim(),
          expected: expected.trim() || null,
          pageUrl: window.location.href,
          landscapeId,
          context: {
            route: pathname,
            userAgent: navigator.userAgent.slice(0, 500),
            viewport: { width: window.innerWidth, height: window.innerHeight },
            filters,
            consoleErrors: errorsAtOpen,
            buildId: process.env.NEXT_PUBLIC_VERCEL_GIT_COMMIT_SHA ?? null,
          },
        }),
      });
      const body = await res.json().catch(() => null) as { ref?: string; error?: string } | null;
      if (!res.ok || !body?.ref) {
        setPhase({ kind: 'failed', message: body?.error ?? 'The report did not send. Try again.' });
        return;
      }
      setPhase({ kind: 'sent', ref: body.ref });
    } catch {
      setPhase({ kind: 'failed', message: 'The report did not send. Check your connection and try again.' });
    }
  }

  return (
    <Dialog open onOpenChange={(next) => { if (!next) onClose(); }} labelledBy="report-bug-title" className="max-w-lg">
      {phase.kind === 'sent' ? (
        <div className="space-y-3 p-5">
          <div className="flex items-center gap-2">
            <CheckCircle2 className="h-4 w-4 text-emerald-600" aria-hidden />
            <h2 id="report-bug-title" className="text-sm font-semibold">Thanks. Logged as {phase.ref}.</h2>
          </div>
          <p className="text-[13px] leading-relaxed text-zinc-600 dark:text-zinc-400">
            Data Dumpster is checking it now. If you included a post link, it looks up whether that post
            was collected and why not, so the fix can start with an answer instead of a question.
          </p>
          <div className="flex justify-end">
            <Button variant="primary" onClick={onClose} data-dialog-initial-focus>Done</Button>
          </div>
        </div>
      ) : (
        <form onSubmit={submit} className="space-y-4 p-5">
          <div>
            <h2 id="report-bug-title" className="text-sm font-semibold">Report a bug</h2>
            <p className="mt-1 text-[13px] text-zinc-500">
              Paste links to any posts involved. They get checked automatically.
            </p>
          </div>

          <Field label="What went wrong?" htmlFor="bug-description">
            <Textarea
              id="bug-description"
              data-dialog-initial-focus
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="We're not seeing this post: https://www.instagram.com/p/..."
              rows={5}
              maxLength={5000}
            />
          </Field>

          <Field label="What did you expect? (optional)" htmlFor="bug-expected">
            <Textarea
              id="bug-expected"
              value={expected}
              onChange={(e) => setExpected(e.target.value)}
              rows={2}
              maxLength={2000}
            />
          </Field>

          <details className="rounded-md border border-zinc-200 px-3 py-2 text-[12px] text-zinc-500 dark:border-zinc-800">
            <summary className="cursor-pointer select-none">What gets sent with this report</summary>
            <p className="mt-2 leading-relaxed">
              Your email, this page ({pathname}), the filters in the address bar, your screen size and browser,
              and {errorsAtOpen.length === 0 ? 'no browser errors (none recorded on this page)' : errorsAtOpen.length + ' recent browser errors'}.
            </p>
          </details>

          {phase.kind === 'failed' ? <FieldError>{phase.message}</FieldError> : null}

          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" onClick={onClose}>Cancel</Button>
            <Button type="submit" variant="primary" disabled={phase.kind === 'sending'}>
              {phase.kind === 'sending' ? 'Sending…' : 'Send report'}
            </Button>
          </div>
        </form>
      )}
    </Dialog>
  );
}
