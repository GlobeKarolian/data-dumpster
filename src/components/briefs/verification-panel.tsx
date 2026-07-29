import * as React from 'react';
import { AlertTriangle, CircleAlert, CircleCheck, ShieldCheck } from 'lucide-react';
import type { BriefVerification } from '@/lib/ai/verify';
import { cn } from '@/lib/utils';
import { Card, CardBody, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { formatDateTime } from '@/components/ui/format';
import { humanizePath } from './verification';

function Stat({ label, value, tone }: { label: string; value: string; tone?: 'ok' | 'warn' }) {
  return (
    <div className="min-w-0">
      <p className="text-[10px] font-semibold uppercase tracking-wider text-zinc-400">{label}</p>
      <p
        className={cn(
          'pb-num mt-0.5 text-lg font-semibold tracking-tight',
          tone === 'warn'
            ? 'text-amber-600 dark:text-amber-500'
            : tone === 'ok'
              ? 'text-emerald-700 dark:text-emerald-400'
              : 'text-zinc-900 dark:text-zinc-50',
        )}
      >
        {value}
      </p>
    </div>
  );
}

/**
 * The verification panel.
 *
 * Rival IQ will print "engagement up 265,895.2%" without blinking. Data Dumpster
 * generates prose only from a pre-computed fact sheet and then, mechanically and
 * without a model, checks every number in the finished text back against that
 * sheet. What you are looking at is the result of that check, stored with the
 * brief so it can be re-read months later.
 *
 * This is a product surface, not a debug view: an editor should be able to open
 * it in a meeting and point at the row that backs the sentence being questioned.
 */
export function VerificationPanel({ verification }: { verification: BriefVerification | null }) {
  if (!verification) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Verification</CardTitle>
        </CardHeader>
        <CardBody>
          <p className="text-xs leading-relaxed text-zinc-500 dark:text-zinc-400">
            This brief has no stored verification record. It was written before checking was in place,
            or the check did not complete. Treat its figures as unaudited and confirm them against the
            leaderboards before quoting them.
          </p>
        </CardBody>
      </Card>
    );
  }

  const { stats, claims } = verification;
  const flagged = claims.filter((c) => !c.found);
  const groundedPct = stats.total > 0 ? Math.round((stats.grounded / stats.total) * 100) : 100;

  return (
    <Card>
      <CardHeader className="items-start">
        <div className="min-w-0">
          <CardTitle className="flex items-center gap-2">
            <ShieldCheck
              className={cn('h-4 w-4', verification.ok ? 'text-emerald-600' : 'text-amber-500')}
              strokeWidth={1.75}
              aria-hidden
            />
            Verification
          </CardTitle>
          <p className="mt-0.5 text-[11px] leading-relaxed text-zinc-500 dark:text-zinc-400">
            Every number in the text above was extracted and matched back to the fact sheet the model
            was given. No model was involved in this check.
          </p>
        </div>
        <Badge tone={verification.ok ? 'positive' : 'warning'}>
          {verification.ok ? 'All claims grounded' : flagged.length + ' to review'}
        </Badge>
      </CardHeader>

      <div className="grid grid-cols-3 gap-4 border-b border-zinc-200 px-4 py-3 dark:border-zinc-800">
        <Stat label="Numeric claims" value={String(stats.total)} />
        <Stat
          label="Grounded"
          value={groundedPct + '%'}
          tone={groundedPct === 100 ? 'ok' : 'warn'}
        />
        <Stat label="With citation" value={String(stats.cited)} />
      </div>

      {claims.length === 0 ? (
        <CardBody>
          <p className="text-xs leading-relaxed text-zinc-500 dark:text-zinc-400">
            The brief contains no numeric claims, so there was nothing to check.
          </p>
        </CardBody>
      ) : (
        <ul className="max-h-96 divide-y divide-zinc-100 overflow-y-auto dark:divide-zinc-800/60">
          {claims.map((claim, i) => (
            <li key={claim.raw + i} className="flex items-start gap-2.5 px-4 py-2.5">
              {claim.found ? (
                <CircleCheck
                  className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-600 dark:text-emerald-500"
                  strokeWidth={2}
                  aria-hidden
                />
              ) : (
                <CircleAlert
                  className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-500"
                  strokeWidth={2}
                  aria-hidden
                />
              )}
              <div className="min-w-0 flex-1">
                <p className="text-xs leading-relaxed text-zinc-700 dark:text-zinc-300">
                  <span className="pb-num rounded bg-zinc-100 px-1 font-semibold text-zinc-900 dark:bg-zinc-800 dark:text-zinc-100">
                    {claim.raw}
                  </span>{' '}
                  <span className="text-zinc-500 dark:text-zinc-400">{claim.text}</span>
                </p>
                {claim.found && claim.matchedPath ? (
                  <p className="mt-1 truncate text-[11px] text-zinc-400 dark:text-zinc-600">
                    {'matched ' + humanizePath(claim.matchedPath)}
                  </p>
                ) : null}
                {!claim.found ? (
                  <p className="mt-1 text-[11px] leading-relaxed text-amber-700 dark:text-amber-500">
                    {claim.nearest
                      ? 'No fact-sheet figure matches. Closest is ' +
                        humanizePath(claim.nearest.path) +
                        ' at ' +
                        claim.nearest.value.toLocaleString('en-US') +
                        '.'
                      : 'No fact-sheet figure matches this number.'}
                  </p>
                ) : null}
              </div>
              <span className="sr-only">{claim.found ? 'Verified' : 'Flagged for review'}</span>
            </li>
          ))}
        </ul>
      )}

      {verification.violations.length > 0 || verification.missingCaveats.length > 0 || verification.miscited.length > 0 ? (
        <div className="space-y-3 border-t border-zinc-200 p-4 dark:border-zinc-800">
          {verification.violations.length > 0 ? (
            <Section
              title="Rule violations"
              hint="Checks that are not about grounding, such as a printed percent change above 1000%."
              items={verification.violations}
            />
          ) : null}
          {verification.missingCaveats.length > 0 ? (
            <Section
              title="Caveats the text left out"
              hint="The fact sheet flagged these as things a reader has to be told. They did not survive into the prose."
              items={verification.missingCaveats}
            />
          ) : null}
          {verification.miscited.length > 0 ? (
            <Section
              title="Miscited figures"
              hint="Grounded, but the citation points somewhere other than the value that actually matched."
              items={verification.miscited}
            />
          ) : null}
        </div>
      ) : null}

      {verification.checkedAt ? (
        <footer className="border-t border-zinc-200 px-4 py-2 text-[11px] text-zinc-400 dark:border-zinc-800 dark:text-zinc-600">
          {'Checked ' + formatDateTime(verification.checkedAt) + ' against the stored fact sheet.'}
        </footer>
      ) : null}
    </Card>
  );
}

function Section({ title, hint, items }: { title: string; hint: string; items: string[] }) {
  return (
    <div>
      <p className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-amber-700 dark:text-amber-500">
        <AlertTriangle className="h-3 w-3" aria-hidden />
        {title}
      </p>
      <p className="mt-0.5 text-[11px] leading-relaxed text-zinc-500">{hint}</p>
      <ul className="mt-1.5 space-y-1">
        {items.map((item, i) => (
          <li key={i} className="text-[11px] leading-relaxed text-zinc-600 dark:text-zinc-400">
            {'— ' + item}
          </li>
        ))}
      </ul>
    </div>
  );
}
