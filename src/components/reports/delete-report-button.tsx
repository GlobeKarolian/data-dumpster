'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { AlertTriangle, Loader2, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';

/**
 * Deleting a weekly report.
 *
 * The delete is permanent, and that is the whole reason this component is more
 * than a button. A report is not a view over data the app can rebuild: the
 * computed half can be regenerated, but the pasted tables and the written
 * narrative exist nowhere else in the system. Someone spent twenty minutes in
 * Adobe and Search Console to produce them, so the confirmation names the
 * report, counts what is about to be lost, and offers the export as a way out.
 *
 * A soft delete would be kinder, and was the first design. It does not work
 * here: `weekly_reports_period_uq` makes (org, landscape, period) unique, so a
 * hidden row would block the user from ever creating another report for that
 * week, which is precisely what someone does after deleting one by mistake.
 * Given the choice between a confusing constraint failure later and an honest
 * warning now, the warning wins.
 */
export function DeleteReportButton({
  reportId,
  title,
  pastedTables,
  narrativeSections,
  redirectTo,
}: {
  reportId: string;
  title: string;
  pastedTables: number;
  narrativeSections: number;
  /** Where to go afterwards. Omit on a list, which only needs a refresh. */
  redirectTo?: string;
}) {
  const router = useRouter();
  const [open, setOpen] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const headingId = React.useId();
  const bodyId = React.useId();

  const handmade = pastedTables + narrativeSections;

  const remove = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch('/api/reports/' + reportId, { method: 'DELETE' });
      if (!res.ok && res.status !== 204) {
        const body = await res.json().catch(() => null);
        throw new Error(body?.message ?? 'The report could not be deleted.');
      }
      setOpen(false);
      if (redirectTo) router.push(redirectTo);
      router.refresh();
    } catch (err) {
      // Stay open on failure. Closing would leave the row on screen with no
      // explanation of why it survived.
      setError(err instanceof Error ? err.message : 'The report could not be deleted.');
      setBusy(false);
    }
  };

  return (
    <>
      <button
        type="button"
        onClick={() => { setError(null); setOpen(true); }}
        aria-label={'Delete ' + title}
        title="Delete report"
        className="rounded p-1.5 text-zinc-400 transition-colors hover:bg-red-50 hover:text-red-600 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-red-600 dark:hover:bg-red-950/40 dark:hover:text-red-400"
      >
        <Trash2 className="h-3.5 w-3.5" aria-hidden />
      </button>

      <Dialog
        open={open}
        onOpenChange={(next) => { if (!busy) setOpen(next); }}
        labelledBy={headingId}
        describedBy={bodyId}
        className="max-w-md"
      >
        <div className="p-5">
          <div className="flex gap-3">
            <span
              aria-hidden
              className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-red-100 dark:bg-red-950/60"
            >
              <AlertTriangle className="h-4 w-4 text-red-600 dark:text-red-400" />
            </span>
            <div className="min-w-0">
              <h2
                id={headingId}
                className="text-sm font-semibold text-zinc-900 dark:text-zinc-50"
              >
                Delete this report permanently?
              </h2>
              <p id={bodyId} className="mt-1.5 text-sm leading-relaxed text-zinc-600 dark:text-zinc-300">
                <span className="font-medium text-zinc-900 dark:text-zinc-100">{title}</span>
                {' will be removed for everyone in your organisation. This cannot be undone.'}
              </p>

              {handmade > 0 ? (
                <div className="mt-3 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 dark:border-amber-900/50 dark:bg-amber-950/30">
                  <p className="text-[12px] leading-relaxed text-amber-900 dark:text-amber-200">
                    {'It holds '}
                    <span className="font-semibold">
                      {pastedTables + (pastedTables === 1 ? ' imported table' : ' imported tables')}
                    </span>
                    {' and '}
                    <span className="font-semibold">
                      {narrativeSections
                        + (narrativeSections === 1 ? ' written section' : ' written sections')}
                    </span>
                    {'. Those were entered by hand and cannot be recomputed. '}
                    <a
                      href={'/api/reports/' + reportId + '/export'}
                      className="font-medium underline underline-offset-2"
                    >
                      Export it first
                    </a>
                    {' if you might need them.'}
                  </p>
                </div>
              ) : null}

              {error ? (
                <p role="alert" className="mt-3 text-[12px] text-red-700 dark:text-red-400">
                  {error}
                </p>
              ) : null}
            </div>
          </div>

          <div className="mt-5 flex justify-end gap-2">
            <Button
              variant="ghost"
              onClick={() => setOpen(false)}
              disabled={busy}
              data-dialog-initial-focus
            >
              Keep it
            </Button>
            <Button variant="danger" onClick={remove} disabled={busy}>
              {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> : null}
              {busy ? 'Deleting…' : 'Delete permanently'}
            </Button>
          </div>
        </div>
      </Dialog>
    </>
  );
}
