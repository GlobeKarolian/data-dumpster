import * as React from 'react';
import type {
  HeadlineStat,
  SummaryResult,
} from '@/lib/metrics/contract';
import {
  PLATFORM_COLORS,
  PLATFORM_LABELS,
  type MetricKey,
} from '@/lib/types';
import { Panel } from '@/components/common/panel';
import { SparkLine } from '@/components/charts/spark-line';
import { DeltaBadge } from '@/components/ui/delta-badge';
import { formatMetric } from '@/components/ui/format';
import { MetricLabel } from '@/components/ui/metric-label';
import { PlatformIcon } from '@/components/ui/platform-icon';
import { Tooltip } from '@/components/ui/tooltip';

export interface CrossChannelGlanceProps {
  summary: SummaryResult | null;
  focusName: string;
  error?: string | null;
}

function MetricColumn({
  label,
  metric,
  stat,
}: {
  label: string;
  metric: MetricKey;
  stat: HeadlineStat | null;
}) {
  const available = stat?.available === true;
  const complete = available && stat?.complete !== false;
  const withheld = available && !complete;
  const previousLabel =
    complete && stat?.previousAvailable && stat.previousComplete !== false && stat.previousValue !== null
      ? formatMetric(stat.previousValue, metric, 'full')
      : undefined;

  return (
    <div className="flex min-h-36 min-w-0 flex-col bg-white p-4 dark:bg-zinc-900/40">
      <p className="text-[10px] font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
        <MetricLabel metric={metric} text={label} />
      </p>
      <div className="mt-2 flex min-w-0 flex-wrap items-baseline gap-x-2 gap-y-1">
        <span className="pb-num text-2xl font-semibold tabular-nums tracking-tight text-zinc-900 dark:text-zinc-50">
          {formatMetric(available ? stat.value : null, metric)}
        </span>
        {/*
          * A withheld comparison says so once, quietly, underneath — not twice
          * and not in alarm colours. The old treatment printed "n/a" beside
          * the headline figure AND an amber warning below it, so the first
          * thing anyone saw on the landing screen was two thirds of the
          * numbers apparently broken. The measurement is fine; only the
          * week-over-week comparison is unavailable, and that is a footnote.
          */}
        {withheld ? null : (
          <DeltaBadge
            changePct={available ? stat.changePct : null}
            previousLabel={previousLabel}
          />
        )}
      </div>
      {withheld ? (
        <Tooltip
          side="bottom"
          content={
            'Some profiles in this window are still collecting, so a week-over-week change would '
            + 'compare unlike periods. The figure above is measured and correct; only the comparison is held back.'
          }
        >
          <p
            tabIndex={0}
            className="mt-1 w-fit cursor-help border-b border-dotted border-zinc-300 text-[11px] text-zinc-500 dark:border-zinc-700 dark:text-zinc-400"
          >
            No week-over-week comparison
          </p>
        </Tooltip>
      ) : null}
      <div className="mt-auto pt-3">
        {available && stat.spark.length > 0 ? (
          <SparkLine
            data={stat.spark}
            height={32}
            filled={false}
            ariaLabel={`${label} over the selected window`}
          />
        ) : (
          <div className="flex h-8 items-center" aria-hidden>
            <div className="h-px w-full bg-zinc-200 dark:bg-zinc-800" />
          </div>
        )}
      </div>
    </div>
  );
}

function TopChannelColumn({ summary }: { summary: SummaryResult | null }) {
  const platform = summary?.topPlatform ?? null;
  const mix = platform
    ? summary?.platformMix.find((row) => row.platform === platform) ?? null
    : null;
  const hasMeasuredEngagement =
    platform !== null
    && mix !== null
    && Number.isFinite(mix.focusValue)
    && mix.focusValue > 0;

  return (
    <div className="flex min-h-36 min-w-0 flex-col bg-white p-4 dark:bg-zinc-900/40">
      <p className="text-[10px] font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
        Your Most Engaging Channel
      </p>
      <div className="mt-2 flex min-w-0 items-center gap-2">
        {hasMeasuredEngagement ? (
          <PlatformIcon platform={platform} className="h-4 w-4" />
        ) : null}
        <span className="truncate text-2xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
          {hasMeasuredEngagement ? PLATFORM_LABELS[platform] : '—'}
        </span>
      </div>
      <p className="mt-1 text-[11px] text-zinc-500 dark:text-zinc-400">
        {hasMeasuredEngagement ? (
          <>
            <span className="pb-num tabular-nums">
              {formatMetric(mix.focusValue, 'engagementTotal')}
            </span>
            {' '}
            <MetricLabel
              metric="engagementTotal"
              text="total engagement"
              className="normal-case"
            />
          </>
        ) : (
          'No channel earned measured engagement in this window.'
        )}
      </p>
      <div className="mt-auto flex h-8 items-end pt-3" aria-hidden>
        <div
          className="h-1 w-full rounded-full bg-zinc-200 dark:bg-zinc-800"
          style={{
            backgroundColor: hasMeasuredEngagement
              ? PLATFORM_COLORS[platform]
              : undefined,
          }}
        />
      </div>
    </div>
  );
}

/**
 * Rival IQ's Cross-Channel at-a-glance block, using Data Dumpster's restrained
 * surfaces and metric definitions. Audience remains the summary's latest
 * in-window snapshot; this component never aggregates or recomputes it.
 */
export function CrossChannelGlance({
  summary,
  focusName,
  error,
}: CrossChannelGlanceProps) {
  return (
    <Panel
      title={`${focusName} at a Glance`}
      bodyClassName="p-0"
      error={error}
    >
      <div className="grid gap-px bg-zinc-200 sm:grid-cols-2 xl:grid-cols-4 dark:bg-zinc-800">
        <MetricColumn
          label="Your Audience"
          metric="audience"
          stat={summary?.headline.audience ?? null}
        />
        <MetricColumn
          label="Your Posts"
          metric="posts"
          stat={summary?.headline.posts ?? null}
        />
        <MetricColumn
          label="Your Engagement Total"
          metric="engagementTotal"
          stat={summary?.headline.engagementTotal ?? null}
        />
        <TopChannelColumn summary={summary} />
      </div>
    </Panel>
  );
}
