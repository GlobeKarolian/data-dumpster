'use client';

import * as React from 'react';
import { ExternalLink, Loader2, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { formatDateTime, formatRelative } from '@/components/ui/format';
import { PLATFORM_LABELS } from '@/lib/types';
import {
  REPORT_PLATFORMS,
  REPORT_PLATFORM_LABELS,
  type ComputedBlock,
  type Movement,
} from '@/lib/reports/types';
import { formatCount, formatPct, formatRate, formatSignedCount } from '@/lib/reports/render';
import { Figure, HeaderWithDefinition, SectionCard } from './ui';

const TH = 'px-3 py-2 text-left text-[11px] font-medium uppercase tracking-wider text-zinc-500 '
  + 'dark:text-zinc-400';
const THR = TH.replace('text-left', 'text-right');
const TD = 'px-3 py-2 text-sm text-zinc-800 dark:text-zinc-200';
const TDR = 'pb-num px-3 py-2 text-right text-sm text-zinc-800 dark:text-zinc-200';

function toneOf(movement: Movement): 'neutral' | 'up' | 'down' {
  if (movement.direction === 'up') return 'up';
  if (movement.direction === 'down') return 'down';
  return 'neutral';
}

function against(movement: Movement, previousLabel: string): string {
  if (movement.previousValue === null) return 'no comparable prior week';
  return formatPct(movement.changePct) + ' vs ' + formatCount(movement.previousValue)
    + ' ' + previousLabel;
}

/** The stamp that answers the only question anyone asks: is this current. */
export function RecomputeBar({
  computedAt,
  busy,
  onRecompute,
  error,
}: {
  computedAt: string | null;
  busy: boolean;
  onRecompute: () => void;
  error: string | null;
}) {
  return (
    <div className="flex flex-wrap items-center justify-end gap-2">
      <span className="pb-num text-[11px] text-zinc-500 dark:text-zinc-400">
        {computedAt
          ? 'Computed ' + formatRelative(computedAt) + ' (' + formatDateTime(computedAt) + ')'
          : 'Never computed'}
      </span>
      <Button size="sm" variant="secondary" onClick={onRecompute} disabled={busy}>
        {busy
          ? <Loader2 className="h-3 w-3 animate-spin" aria-hidden />
          : <RefreshCw className="h-3 w-3" aria-hidden />}
        {busy ? 'Recomputing' : 'Recompute'}
      </Button>
      {error ? (
        <span className="w-full text-right text-[11px] text-red-600 dark:text-red-400">{error}</span>
      ) : null}
    </div>
  );
}

export function PerformanceSection({ computed }: { computed: ComputedBlock }) {
  const f = computed.focus;
  const brand = f.companyName ?? 'Focus brand not set';
  return (
    <SectionCard
      title="Performance"
      kind="computed"
      description={
        brand + ', ' + computed.period.start + ' to ' + computed.period.end
        + ', measured against ' + computed.previousPeriod.start + ' to ' + computed.previousPeriod.end + '.'
      }
    >
      <div className="grid grid-cols-2 gap-x-6 gap-y-5 p-4 md:grid-cols-4">
        <Figure
          label="Net followers"
          hint={
            'Followers on the last day of the window minus followers on the first day, summed '
            + 'across Facebook, Instagram, YouTube, X and TikTok. This is growth inside the week, '
            + 'not the total audience.'
          }
          value={formatSignedCount(f.netFollowers)}
          tone={f.netFollowers > 0 ? 'up' : f.netFollowers < 0 ? 'down' : 'neutral'}
          sub={f.previousNetFollowers === null
            ? 'no comparable prior week'
            : formatSignedCount(f.previousNetFollowers) + ' the week before'}
        />
        <Figure
          label="Total followers"
          metric="audience"
          value={formatCount(f.followers.value)}
          sub={against(f.followers, 'a week earlier')}
        />
        <Figure
          label="Engagement total"
          metric="engagementTotal"
          value={formatCount(f.engagementTotal.value)}
          tone={toneOf(f.engagementTotal)}
          sub={against(f.engagementTotal, 'the week before')}
        />
        <Figure
          label="Engagement per post"
          metric="engagementPerPost"
          value={formatRate(f.engagementPerPost.value)}
          tone={toneOf(f.engagementPerPost)}
          sub={formatCount(f.posts.value) + ' posts, '
            + (f.engagementPerPost.previousValue === null
              ? 'no prior rate'
              : formatPct(f.engagementPerPost.changePct) + ' week over week')}
        />
      </div>
      {computed.caveats.length > 0 ? (
        <div className="border-t border-zinc-200 px-4 py-3 dark:border-zinc-800">
          <p className="text-[11px] font-medium uppercase tracking-wider text-amber-600 dark:text-amber-500">
            Measurement notes
          </p>
          <ul className="mt-1 space-y-1">
            {computed.caveats.map((caveat) => (
              <li key={caveat} className="text-xs leading-relaxed text-zinc-600 dark:text-zinc-400">
                {caveat}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </SectionCard>
  );
}

export function BrandsSection({ computed }: { computed: ComputedBlock }) {
  return (
    <SectionCard
      title="Owned Brands Key Metrics"
      kind="computed"
      description="Every brand in the landscape, ranked by total followers across the five platforms the printed report carries."
    >
      <div className="overflow-x-auto">
        <table className="w-full border-collapse">
          <thead className="border-b border-zinc-200 dark:border-zinc-800">
            <tr>
              <th className={THR} scope="col">#</th>
              <th className={TH} scope="col">Brand</th>
              <th className={THR} scope="col">
                <HeaderWithDefinition label="Total followers" metric="audience" />
              </th>
              <th className={THR} scope="col">
                <HeaderWithDefinition
                  label="Net change"
                  hint="Followers on the last day of the window minus the first day, summed across the five platforms."
                />
              </th>
              {REPORT_PLATFORMS.map((p) => (
                <th key={p} className={THR} scope="col">{REPORT_PLATFORM_LABELS[p]}</th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800/60">
            {computed.brands.map((b) => (
              <tr key={b.companyId}>
                <td className="pb-num px-3 py-2 text-right text-xs text-zinc-400">{b.rank}</td>
                <td className={TD + ' font-medium whitespace-nowrap'}>{b.name}</td>
                <td className={TDR}>{formatCount(b.totalFollowers)}</td>
                <td
                  className={TDR + (b.netChange > 0
                    ? ' text-emerald-700 dark:text-emerald-400'
                    : b.netChange < 0 ? ' text-red-700 dark:text-red-400' : '')}
                >
                  {formatSignedCount(b.netChange)}
                </td>
                {REPORT_PLATFORMS.map((p) => (
                  <td key={p} className={TDR + ' text-zinc-500 dark:text-zinc-400'}>
                    {b.byPlatform[p] === undefined ? '—' : formatCount(b.byPlatform[p])}
                  </td>
                ))}
              </tr>
            ))}
            {computed.brands.length === 0 ? (
              <tr>
                <td className={TD + ' text-zinc-500'} colSpan={4 + REPORT_PLATFORMS.length}>
                  No brands in this landscape have audience data for the window.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </SectionCard>
  );
}

export function TopPostsSection({ computed }: { computed: ComputedBlock }) {
  return (
    <SectionCard
      title="Top Engaged Posts"
      kind="computed"
      description="The three most engaged posts anywhere in the landscape this week."
    >
      <ol className="divide-y divide-zinc-100 dark:divide-zinc-800/60">
        {computed.topPosts.map((p) => (
          <li key={p.id} className="flex items-start gap-3 px-4 py-3">
            <span className="pb-num mt-0.5 w-4 shrink-0 text-right text-xs text-zinc-400">{p.rank}</span>
            <div className="min-w-0 flex-1">
              <p className="text-sm leading-relaxed text-zinc-800 dark:text-zinc-200">
                {p.text && p.text.trim() ? p.text.slice(0, 220) : 'No post text was captured.'}
              </p>
              <p className="pb-num mt-1 text-[11px] text-zinc-500">
                {p.companyName + ' · ' + (PLATFORM_LABELS[p.platform] ?? p.platform)
                  + ' · ' + formatDateTime(p.postedAt)}
              </p>
            </div>
            <div className="shrink-0 text-right">
              <p className="pb-num text-sm font-semibold text-zinc-900 dark:text-zinc-50">
                {formatCount(p.engagementTotal)}
              </p>
              {p.permalink ? (
                <a
                  href={p.permalink}
                  target="_blank"
                  rel="noreferrer"
                  className="mt-0.5 inline-flex items-center gap-1 text-[11px] text-zinc-500 transition-colors hover:text-accent-600"
                >
                  Open
                  <ExternalLink className="h-2.5 w-2.5" aria-hidden />
                </a>
              ) : null}
            </div>
          </li>
        ))}
        {computed.topPosts.length === 0 ? (
          <li className="px-4 py-4 text-sm text-zinc-500">No posts were recorded in this window.</li>
        ) : null}
      </ol>
    </SectionCard>
  );
}

export function CohortSection({ computed }: { computed: ComputedBlock }) {
  const cohort = computed.cohort;
  return (
    <SectionCard
      title="Boston News Landscape"
      kind="computed"
      description={
        cohort.memberCount + ' brands in ' + cohort.landscapeName
        + ', ranked by engagement for the week.'
      }
    >
      <div className="grid grid-cols-2 gap-x-6 gap-y-5 border-b border-zinc-200 p-4 md:grid-cols-3 dark:border-zinc-800">
        <Figure
          label="Cohort engagement"
          metric="engagementTotal"
          value={formatCount(cohort.engagement.value)}
          tone={toneOf(cohort.engagement)}
          sub={against(cohort.engagement, 'the week before')}
        />
        <Figure
          label="Our rank"
          hint="Position of the landscape focus brand when every brand is ordered by total engagement for the window."
          value={cohort.focusRank ? cohort.focusRank + ' of ' + cohort.memberCount : '—'}
          sub={cohort.focusCompanyName ?? 'No focus brand is set on this landscape'}
        />
        <Figure
          label="Best post rank"
          hint="Where the focus brand's strongest post placed among the most engaged posts in the whole landscape this week."
          value={cohort.focusPostRank
            ? cohort.focusPostRank + ' of ' + cohort.focusPostPool
            : 'Outside top ' + cohort.focusPostPool}
          sub="Across every brand in the landscape"
        />
      </div>
      <div className="overflow-x-auto">
        <table className="w-full border-collapse">
          <thead className="border-b border-zinc-200 dark:border-zinc-800">
            <tr>
              <th className={THR} scope="col">#</th>
              <th className={TH} scope="col">Brand</th>
              <th className={THR} scope="col">
                <HeaderWithDefinition label="Engagement" metric="engagementTotal" />
              </th>
              <th className={THR} scope="col">
                <HeaderWithDefinition
                  label="Week over week"
                  hint="Change against the same brand in the previous seven-day window. Blank where the prior week was zero."
                />
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800/60">
            {cohort.rows.map((r) => (
              <tr
                key={r.companyId}
                className={r.isFocus ? 'bg-accent-600/5 dark:bg-accent-600/10' : undefined}
              >
                <td className="pb-num px-3 py-2 text-right text-xs text-zinc-400">{r.rank}</td>
                <td className={TD + (r.isFocus ? ' font-semibold text-accent-700 dark:text-accent-400' : '')}>
                  {r.name}
                </td>
                <td className={TDR}>{formatCount(r.engagementTotal)}</td>
                <td
                  className={TDR + (r.changePct === null
                    ? ' text-zinc-400'
                    : r.changePct > 0
                      ? ' text-emerald-700 dark:text-emerald-400'
                      : r.changePct < 0 ? ' text-red-700 dark:text-red-400' : '')}
                >
                  {r.changePct === null ? '—' : formatPct(r.changePct)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </SectionCard>
  );
}
