'use client';

import * as React from 'react';
import { ChevronDown } from 'lucide-react';
import type { FactSheet } from '@/lib/metrics/contract';
import { METRIC_DEFS } from '@/lib/metrics/definitions';
import type { MetricKey } from '@/lib/types';
import { cn } from '@/lib/utils';
import { formatMetric, formatFullDate } from '@/components/ui/format';
import { Badge } from '@/components/ui/badge';

function Section({
  title,
  count,
  defaultOpen,
  children,
}: {
  title: string;
  count?: number;
  defaultOpen?: boolean;
  children: React.ReactNode;
}) {
  const [open, setOpen] = React.useState(defaultOpen ?? false);
  return (
    <div className="border-b border-zinc-200 last:border-0 dark:border-zinc-800">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left transition-colors hover:bg-zinc-50 dark:hover:bg-zinc-800/40"
      >
        <span className="text-[11px] font-semibold uppercase tracking-wider text-zinc-500 dark:text-zinc-400">
          {title}
        </span>
        <span className="flex items-center gap-1.5">
          {typeof count === 'number' ? (
            <span className="pb-num text-[10px] text-zinc-400">{count}</span>
          ) : null}
          <ChevronDown
            className={cn('h-3 w-3 text-zinc-400 transition-transform', open && 'rotate-180')}
            aria-hidden
          />
        </span>
      </button>
      {open ? <div className="px-3 pb-3">{children}</div> : null}
    </div>
  );
}

/**
 * The fact sheet, shown next to the answer.
 *
 * The model that answers questions here never touches the database. It is given
 * this and only this, and told it may restate what is in it and nothing else.
 * Putting the sheet on screen is what turns "trust the assistant" into "check
 * the assistant", which is the only version a newsroom should accept.
 */
export function FactSheetPanel({ facts }: { facts: FactSheet | null }) {
  if (!facts) {
    return (
      <div className="rounded-lg border border-zinc-200 p-4 dark:border-zinc-800">
        <p className="text-xs leading-relaxed text-zinc-500 dark:text-zinc-400">
          No fact sheet could be computed for this landscape and window, so there is nothing for a
          model to be grounded in. Answers here would be guesses, and the assistant will say so.
        </p>
      </div>
    );
  }

  const leaderboards = Object.entries(facts.leaderboards) as [MetricKey, FactSheet['leaderboards'][MetricKey]][];

  return (
    <div className="overflow-hidden rounded-lg border border-zinc-200 dark:border-zinc-800">
      <div className="border-b border-zinc-200 bg-zinc-50 px-3 py-2.5 dark:border-zinc-800 dark:bg-zinc-900/60">
        <p className="text-xs font-semibold text-zinc-900 dark:text-zinc-100">Grounding fact sheet</p>
        <p className="pb-num mt-0.5 text-[11px] text-zinc-500">
          {facts.landscape.name +
            ' · ' +
            formatFullDate(facts.range.start) +
            ' – ' +
            formatFullDate(facts.range.end) +
            ' · ' +
            facts.range.days +
            ' days'}
        </p>
      </div>

      <Section title="Companies" count={facts.companies.length} defaultOpen>
        <ul className="space-y-1">
          {facts.companies.map((c) => (
            <li key={c.id} className="flex items-center gap-2 text-[11px] text-zinc-600 dark:text-zinc-400">
              <span
                aria-hidden
                className="h-1.5 w-1.5 shrink-0 rounded-full"
                style={{ backgroundColor: c.color ?? '#71717a' }}
              />
              <span className="truncate">{c.name}</span>
              {facts.landscape.focusCompany === c.name ? <Badge tone="accent">Focus</Badge> : null}
            </li>
          ))}
        </ul>
      </Section>

      <Section title="Leaderboards" count={leaderboards.length}>
        <div className="space-y-3">
          {leaderboards.map(([metric, rows]) => (
            <div key={metric}>
              <p className="text-[10px] font-semibold uppercase tracking-wider text-zinc-400">
                {METRIC_DEFS[metric].label}
              </p>
              <ul className="mt-1 space-y-0.5">
                {(rows ?? []).slice(0, 5).map((row) => (
                  <li
                    key={row.company.id}
                    className="flex items-baseline gap-2 text-[11px] text-zinc-600 dark:text-zinc-400"
                  >
                    <span className="pb-num w-3 shrink-0 text-zinc-400">{row.rank}</span>
                    <span className="min-w-0 flex-1 truncate">{row.company.name}</span>
                    <span className="pb-num shrink-0 font-medium text-zinc-900 dark:text-zinc-200">
                      {formatMetric(row.value, metric)}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </Section>

      <Section title="Detected movements" count={facts.anomalies.length}>
        <ul className="space-y-2">
          {facts.anomalies.length === 0 ? (
            <li className="text-[11px] text-zinc-500">Nothing crossed the detection threshold.</li>
          ) : (
            facts.anomalies.map((a, i) => (
              <li key={i} className="text-[11px] leading-relaxed text-zinc-600 dark:text-zinc-400">
                {a.statement}
              </li>
            ))
          )}
        </ul>
      </Section>

      <Section title="Caveats" count={facts.caveats.length} defaultOpen={facts.caveats.length > 0}>
        <ul className="space-y-1.5">
          {facts.caveats.length === 0 ? (
            <li className="text-[11px] text-zinc-500">No data-quality warnings for this window.</li>
          ) : (
            facts.caveats.map((c, i) => (
              <li key={i} className="text-[11px] leading-relaxed text-amber-700 dark:text-amber-500">
                {'— ' + c}
              </li>
            ))
          )}
        </ul>
      </Section>

      <Section title="Top posts" count={facts.topPostsOverall.length}>
        <ul className="space-y-2">
          {facts.topPostsOverall.slice(0, 6).map((p) => (
            <li key={p.id} className="text-[11px] leading-relaxed text-zinc-600 dark:text-zinc-400">
              <span className="font-medium text-zinc-800 dark:text-zinc-300">{p.company.name}</span>
              {' · '}
              <span className="pb-num">{formatMetric(p.engagementTotal, 'engagementTotal')}</span>
            </li>
          ))}
        </ul>
      </Section>
    </div>
  );
}
