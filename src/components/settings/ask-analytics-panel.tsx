import * as React from 'react';
import { FlaskConical, CheckCircle2, Wrench, XCircle, AlertTriangle } from 'lucide-react';
import { compactNumber } from '@/lib/utils';
import { Card, CardHeader, CardTitle } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { formatUsd } from '@/components/ui/format';

export interface AskOutcomeRow {
  outcome: string;
  calls: number;
  costUsd: number;
  inputTokens: number;
  outputTokens: number;
}

export interface AskRecentRow {
  id: string;
  question: string;
  outcome: string;
  model: string | null;
  costUsd: number | null;
  latencyMs: number | null;
  createdAt: string;
}

export interface UsageEventRow {
  surface: string;
  action: string;
  events: number;
  lastAt: string;
}

const OUTCOME_META: Record<string, { label: string; icon: typeof CheckCircle2; tone: string }> = {
  verified: { label: 'Verified', icon: CheckCircle2, tone: 'text-emerald-600 dark:text-emerald-400' },
  repaired: { label: 'Repaired', icon: Wrench, tone: 'text-amber-600 dark:text-amber-400' },
  rejected: { label: 'Rejected', icon: XCircle, tone: 'text-red-600 dark:text-red-400' },
  error: { label: 'Error', icon: AlertTriangle, tone: 'text-red-600 dark:text-red-400' },
};

function outcomeMeta(outcome: string) {
  return OUTCOME_META[outcome] ?? { label: outcome, icon: FlaskConical, tone: 'text-zinc-500' };
}

function shortTime(iso: string): string {
  const d = new Date(iso);
  return new Intl.DateTimeFormat('en-US', {
    month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit',
  }).format(d);
}

/**
 * The Ask (Alpha) feedback loop, rendered.
 *
 * The top table answers "how often does the verifier have to save this"; the
 * recent list is where a bad answer gets found and read. Repaired and rejected
 * are the two numbers that should fall as prompts and the verifier improve.
 */
export function AskAnalyticsPanel({
  outcomes,
  recent,
  events,
}: {
  outcomes: AskOutcomeRow[];
  recent: AskRecentRow[];
  events: UsageEventRow[];
}) {
  const totalCalls = outcomes.reduce((a, r) => a + r.calls, 0);
  const totalCost = outcomes.reduce((a, r) => a + r.costUsd, 0);
  const verified = outcomes.find((r) => r.outcome === 'verified')?.calls ?? 0;
  const repaired = outcomes.find((r) => r.outcome === 'repaired')?.calls ?? 0;
  const rejected = outcomes.find((r) => r.outcome === 'rejected')?.calls ?? 0;
  const cleanRate = totalCalls > 0 ? verified / totalCalls : 0;

  return (
    <>
      <Card>
        <CardHeader>
          <div>
            <CardTitle>Verification outcomes</CardTitle>
            <p className="mt-0.5 text-xs text-zinc-500 dark:text-zinc-400">
              Every Ask answer is verified against the fact sheet before it renders. Verified means
              it passed first try; repaired means the verifier rewrote it; rejected means no answer
              was shown at all.
            </p>
          </div>
          <div className="text-right">
            <p className="pb-num text-xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
              {totalCalls}
            </p>
            <p className="text-[10px] uppercase tracking-wider text-zinc-400">questions</p>
          </div>
        </CardHeader>

        {totalCalls === 0 ? (
          <EmptyState
            compact
            icon={FlaskConical}
            title="No Ask interactions yet"
            description="Ask a question on the Ask page and the outcome shows up here. This is the log the Alpha banner says we keep."
          />
        ) : (
          <>
            <div className="grid grid-cols-2 gap-px border-t border-zinc-200 bg-zinc-100 dark:border-zinc-800 dark:bg-zinc-800/60 sm:grid-cols-4">
              {[
                { label: 'Clean first-try', value: Math.round(cleanRate * 100) + '%', tone: 'text-emerald-600 dark:text-emerald-400' },
                { label: 'Repaired', value: String(repaired), tone: 'text-amber-600 dark:text-amber-400' },
                { label: 'Rejected', value: String(rejected), tone: 'text-red-600 dark:text-red-400' },
                { label: 'Total cost', value: formatUsd(totalCost), tone: 'text-zinc-900 dark:text-zinc-100' },
              ].map((s) => (
                <div key={s.label} className="bg-white px-4 py-3 dark:bg-zinc-900">
                  <p className={'pb-num text-lg font-semibold ' + s.tone}>{s.value}</p>
                  <p className="text-[10px] uppercase tracking-wider text-zinc-400">{s.label}</p>
                </div>
              ))}
            </div>

            <table className="w-full text-xs">
              <caption className="sr-only">Ask outcomes</caption>
              <thead>
                <tr className="border-b border-zinc-200 text-left text-zinc-500 dark:border-zinc-800 dark:text-zinc-400">
                  <th scope="col" className="px-4 py-2 font-medium">Outcome</th>
                  <th scope="col" className="px-2 py-2 text-right font-medium">Count</th>
                  <th scope="col" className="px-2 py-2 text-right font-medium">Input</th>
                  <th scope="col" className="px-2 py-2 text-right font-medium">Output</th>
                  <th scope="col" className="px-4 py-2 text-right font-medium">Cost</th>
                </tr>
              </thead>
              <tbody>
                {outcomes.map((r) => {
                  const meta = outcomeMeta(r.outcome);
                  return (
                    <tr key={r.outcome} className="border-b border-zinc-100 last:border-0 dark:border-zinc-800/60">
                      <td className="px-4 py-2">
                        <span className={'inline-flex items-center gap-1.5 font-medium ' + meta.tone}>
                          <meta.icon className="h-3.5 w-3.5" aria-hidden />
                          {meta.label}
                        </span>
                      </td>
                      <td className="pb-num px-2 py-2 text-right text-zinc-600 dark:text-zinc-400">{r.calls}</td>
                      <td className="pb-num px-2 py-2 text-right text-zinc-600 dark:text-zinc-400">{compactNumber(r.inputTokens)}</td>
                      <td className="pb-num px-2 py-2 text-right text-zinc-600 dark:text-zinc-400">{compactNumber(r.outputTokens)}</td>
                      <td className="pb-num px-4 py-2 text-right font-medium text-zinc-900 dark:text-zinc-100">{formatUsd(r.costUsd)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </>
        )}
      </Card>

      <Card>
        <CardHeader>
          <div>
            <CardTitle>Recent questions</CardTitle>
            <p className="mt-0.5 text-xs text-zinc-500 dark:text-zinc-400">
              The last 50 interactions. Read the repaired and rejected ones first — they are where
              the assistant came closest to saying something wrong.
            </p>
          </div>
        </CardHeader>
        {recent.length === 0 ? (
          <EmptyState
            compact
            icon={FlaskConical}
            title="Nothing logged yet"
            description="Questions and their verification outcomes will appear here as they happen."
          />
        ) : (
          <ul className="divide-y divide-zinc-100 dark:divide-zinc-800/60">
            {recent.map((r) => {
              const meta = outcomeMeta(r.outcome);
              return (
                <li key={r.id} className="flex items-start gap-3 px-4 py-2.5">
                  <meta.icon className={'mt-0.5 h-3.5 w-3.5 shrink-0 ' + meta.tone} aria-hidden />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-xs text-zinc-800 dark:text-zinc-200">{r.question}</p>
                    <p className="mt-0.5 text-[10px] text-zinc-400">
                      {meta.label + ' · ' + (r.model ?? 'unknown model') + ' · ' + shortTime(r.createdAt)}
                      {r.latencyMs !== null ? ' · ' + (r.latencyMs / 1000).toFixed(1) + 's' : ''}
                      {r.costUsd !== null ? ' · ' + formatUsd(r.costUsd) : ''}
                    </p>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </Card>

      <Card>
        <CardHeader>
          <div>
            <CardTitle>Product usage</CardTitle>
            <p className="mt-0.5 text-xs text-zinc-500 dark:text-zinc-400">
              First-party events across surfaces. No third-party analytics — this is recorded in our
              own tables because what a newsroom tracks is itself competitive.
            </p>
          </div>
        </CardHeader>
        {events.length === 0 ? (
          <EmptyState
            compact
            icon={FlaskConical}
            title="No usage events yet"
            description="Events are recorded as features are used. This fills in over time."
          />
        ) : (
          <table className="w-full text-xs">
            <caption className="sr-only">Product usage by surface and action</caption>
            <thead>
              <tr className="border-b border-zinc-200 text-left text-zinc-500 dark:border-zinc-800 dark:text-zinc-400">
                <th scope="col" className="px-4 py-2 font-medium">Surface</th>
                <th scope="col" className="px-4 py-2 font-medium">Action</th>
                <th scope="col" className="px-2 py-2 text-right font-medium">Events</th>
                <th scope="col" className="px-4 py-2 text-right font-medium">Last</th>
              </tr>
            </thead>
            <tbody>
              {events.map((r) => (
                <tr key={r.surface + ':' + r.action} className="border-b border-zinc-100 last:border-0 dark:border-zinc-800/60">
                  <td className="px-4 py-2 font-medium text-zinc-700 dark:text-zinc-300">{r.surface}</td>
                  <td className="px-4 py-2 text-zinc-600 dark:text-zinc-400">{r.action}</td>
                  <td className="pb-num px-2 py-2 text-right text-zinc-600 dark:text-zinc-400">{r.events}</td>
                  <td className="px-4 py-2 text-right text-[11px] text-zinc-400">{shortTime(r.lastAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
    </>
  );
}
