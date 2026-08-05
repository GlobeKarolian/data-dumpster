'use client';

import Link from 'next/link';
import { ArrowRight, Scale, Trophy } from 'lucide-react';
import { hrefWithGlobalParams, useUrlState } from '@/components/common/use-url-state';
import { Panel } from '@/components/common/panel';
import { PLATFORM_COLORS, PLATFORM_LABELS, PLATFORMS, type MetricKey, type MetricRow, type Platform } from '@/lib/types';
import { METRIC_DEFS } from '@/lib/metrics/definitions';
import { measuredCompetitorAverage } from '@/lib/metrics/availability';
import { platformMetricLabel } from '@/lib/platform-language';
import { cn, formatChange } from '@/lib/utils';
import { DeltaBadge } from '@/components/ui/delta-badge';
import { formatMetric } from '@/components/ui/format';
import { MetricLabel } from '@/components/ui/metric-label';

export interface OverviewBenchmarkPanelProps {
  metric: MetricKey;
  rows: MetricRow[];
  focusCompanyId: string | null;
  focusName: string;
  platform?: Platform;
  /** Optional Engagement Rate by Follower rows for a second, size-neutral insight. */
  secondaryRows?: MetricRow[];
  error?: string | null;
}

interface BarSegment {
  platform: Platform;
  value: number;
}

const STACKABLE_METRICS = new Set<MetricKey>([
  'audience',
  'posts',
  'engagementTotal',
  'applause',
  'conversation',
  'amplification',
  'saves',
  'views',
]);

function possessive(name: string): string {
  const clean = name.trim() || 'Focus company';
  return clean.endsWith('s') ? clean + '’' : clean + '’s';
}

function sectionName(metric: MetricKey): string {
  if (metric === 'audience') return 'Audience';
  if (metric === 'posts') return 'Activity';
  if (metric === 'engagementTotal') return 'Engagement';
  return METRIC_DEFS[metric].label;
}

function ordinal(rank: number): string {
  const mod100 = rank % 100;
  if (mod100 >= 11 && mod100 <= 13) return rank + 'th';
  if (rank % 10 === 1) return rank + 'st';
  if (rank % 10 === 2) return rank + 'nd';
  if (rank % 10 === 3) return rank + 'rd';
  return rank + 'th';
}

function relativeDifference(value: number, baseline: number | null): number | null {
  if (baseline === null || baseline === 0 || !Number.isFinite(value) || !Number.isFinite(baseline)) {
    return null;
  }
  return (value - baseline) / baseline;
}

function comparisonSentence(
  focusName: string,
  value: number,
  average: number | null,
): string {
  if (average === null) return 'A measured competitor average is not available for this scope.';
  if (average === 0) {
    return value === 0
      ? focusName + ' matches the measured competitor average at zero.'
      : 'The measured competitor average is zero, so a percentage comparison would be misleading.';
  }

  const difference = relativeDifference(value, average);
  if (difference === null || Math.abs(difference) < 0.001) {
    return focusName + ' is in line with the measured competitor average.';
  }
  const magnitude = formatChange(Math.abs(difference)).label.replace(/^[+-]/, '');
  return focusName + ' is ' + magnitude + (difference > 0 ? ' above ' : ' below ')
    + 'the measured competitor average.';
}

function measuredRows(rows: MetricRow[]): MetricRow[] {
  return rows.filter((row) => row.available && Number.isFinite(row.value));
}

function platformSegments(
  rows: MetricRow[],
  focusCompanyId: string | null,
  kind: 'focus' | 'competitors',
): BarSegment[] {
  const candidates = rows.filter((row) =>
    kind === 'focus'
      ? row.company.id === focusCompanyId && row.available
      : row.company.id !== focusCompanyId && row.available);

  return PLATFORMS.flatMap((platform) => {
    const values = candidates.flatMap((row) => {
      if (row.breakdownAvailability?.[platform] !== true) return [];
      const value = row.breakdown?.[platform];
      return value !== undefined && Number.isFinite(value) ? [value] : [];
    });
    if (values.length === 0) return [];
    const value = kind === 'focus'
      ? values[0]
      : values.reduce((sum, item) => sum + item, 0) / values.length;
    return value > 0 ? [{ platform, value }] : [];
  });
}

function BenchmarkBar({
  label,
  value,
  available,
  maxValue,
  metric,
  segments,
  focus,
  changePct,
  previousValue,
}: {
  label: string;
  value: number;
  available: boolean;
  maxValue: number;
  metric: MetricKey;
  segments: BarSegment[];
  focus?: boolean;
  changePct?: number | null;
  previousValue?: number | null;
}) {
  const width = available && maxValue > 0 ? Math.max(0, Math.min(100, (value / maxValue) * 100)) : 0;
  const segmentTotal = segments.reduce((sum, segment) => sum + segment.value, 0);

  return (
    <div>
      <div className="mb-1.5 flex min-w-0 items-end justify-between gap-3">
        <span className={cn(
          'truncate text-xs',
          focus ? 'font-semibold text-zinc-900 dark:text-zinc-100' : 'font-medium text-zinc-500 dark:text-zinc-400',
        )}
        >
          {label}
        </span>
        <span className="flex shrink-0 items-baseline gap-1.5">
          <span className="pb-num text-sm font-semibold tabular-nums text-zinc-900 dark:text-zinc-100">
            {available ? formatMetric(value, metric) : '—'}
          </span>
          {focus && available ? (
            <DeltaBadge
              changePct={changePct}
              previousLabel={previousValue === null || previousValue === undefined
                ? undefined
                : formatMetric(previousValue, metric, 'full')}
            />
          ) : null}
        </span>
      </div>
      <div
        className="h-5 overflow-hidden rounded-sm bg-zinc-100 dark:bg-zinc-800"
        role="img"
        aria-label={label + ': ' + (available ? formatMetric(value, metric, 'full') : 'not available')}
      >
        <div
          className={cn(
            'flex h-full min-w-0 overflow-hidden rounded-sm',
            segments.length === 0 && (focus ? 'bg-accent-600' : 'bg-zinc-400 dark:bg-zinc-500'),
          )}
          style={{ width: width + '%' }}
        >
          {segments.map((segment) => (
            <span
              key={segment.platform}
              className="h-full"
              style={{
                width: segmentTotal > 0 ? (segment.value / segmentTotal) * 100 + '%' : '0%',
                backgroundColor: PLATFORM_COLORS[segment.platform],
              }}
              title={PLATFORM_LABELS[segment.platform] + ': ' + formatMetric(segment.value, metric, 'full')}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

export function OverviewBenchmarkPanel({
  metric,
  rows,
  focusCompanyId,
  focusName,
  platform,
  secondaryRows,
  error,
}: OverviewBenchmarkPanelProps) {
  const { searchParams } = useUrlState();
  const focus = rows.find((row) => row.company.id === focusCompanyId);
  const average = measuredCompetitorAverage(rows, focusCompanyId);
  const availableRows = measuredRows(rows);
  const metricLabel = platform ? platformMetricLabel(metric, platform) : METRIC_DEFS[metric].label;
  const leaderboardHref = hrefWithGlobalParams(
    '/leaderboard',
    searchParams,
    platform ? { platforms: [platform] } : undefined,
  );

  const insights: string[] = [];
  if (!focus || !focus.available) {
    insights.push('No measured ' + metricLabel.toLowerCase() + ' is available for ' + focusName + ' in this window.');
  } else {
    insights.push(
      focusName + ' ranks ' + ordinal(focus.rank) + ' of ' + availableRows.length
      + ' measured companies for ' + metricLabel.toLowerCase()
      + (focus.complete === false ? ' on partial coverage; treat this rank as provisional.' : '.'),
    );
  }

  const secondaryFocus = secondaryRows?.find((row) => row.company.id === focusCompanyId);
  const secondaryAverage = secondaryRows
    ? measuredCompetitorAverage(secondaryRows, focusCompanyId)
    : null;
  if (secondaryFocus?.available) {
    const secondaryLabel = platform
      ? platformMetricLabel('engagementRateByFollower', platform)
      : METRIC_DEFS.engagementRateByFollower.label;
    const secondaryCount = measuredRows(secondaryRows ?? []).length;
    const context = relativeDifference(secondaryFocus.value, secondaryAverage);
    const comparison = context === null
      ? ''
      : Math.abs(context) < 0.001
        ? ' and is in line with the measured competitor average'
        : ' and sits ' + formatChange(Math.abs(context)).label.replace(/^[+-]/, '')
          + (context > 0 ? ' above' : ' below') + ' the measured competitor average';
    insights.push(
      secondaryLabel + ' ranks ' + ordinal(secondaryFocus.rank) + ' of ' + secondaryCount
      + ' measured companies' + comparison + '.',
    );
  } else if (focus?.available) {
    insights.push(comparisonSentence(focusName, focus.value, average));
  }

  const useBreakdown = !platform && STACKABLE_METRICS.has(metric);
  const focusSegments = useBreakdown ? platformSegments(rows, focusCompanyId, 'focus') : [];
  const competitorSegments = useBreakdown ? platformSegments(rows, focusCompanyId, 'competitors') : [];
  const legendPlatforms = PLATFORMS.filter((candidate) =>
    focusSegments.some((segment) => segment.platform === candidate)
    || competitorSegments.some((segment) => segment.platform === candidate));
  const focusValue = focus?.available && Number.isFinite(focus.value) ? focus.value : 0;
  const maxValue = Math.max(0, focusValue, average ?? 0);

  return (
    <Panel
      metric={metric}
      title={possessive(focusName) + ' ' + sectionName(metric)}
      error={error}
      note={METRIC_DEFS[metric].caveat}
      toolbar={
        <Link
          href={leaderboardHref}
          className="inline-flex items-center gap-1 text-xs font-medium text-accent-600 hover:underline dark:text-accent-500"
        >
          View leaderboard
          <ArrowRight className="h-3 w-3" aria-hidden />
        </Link>
      }
      bodyClassName="p-0"
    >
      <div className="grid min-w-0 lg:grid-cols-[minmax(15rem,0.8fr)_minmax(22rem,1.35fr)]">
        <div className="border-b border-zinc-200 p-4 lg:border-b-0 lg:border-r dark:border-zinc-800">
          <p className="mb-3 text-[10px] font-semibold uppercase tracking-wider text-zinc-400 dark:text-zinc-500">
            What this means
          </p>
          <ul className="space-y-3">
            {insights.slice(0, 2).map((insight, index) => {
              const Icon = index === 0 ? Trophy : Scale;
              return (
                <li key={insight} className="flex gap-2.5 text-xs leading-relaxed text-zinc-600 dark:text-zinc-300">
                  <Icon className="mt-0.5 h-3.5 w-3.5 shrink-0 text-zinc-400" strokeWidth={1.75} aria-hidden />
                  <span>{insight}</span>
                </li>
              );
            })}
          </ul>
        </div>

        <div className="min-w-0 p-4">
          <div className="mb-4 text-[11px] font-medium uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
            <MetricLabel metric={metric} text={metricLabel} />
          </div>
          <div className="space-y-4">
            <BenchmarkBar
              label={focusName}
              value={focusValue}
              available={focus?.available ?? false}
              maxValue={maxValue}
              metric={metric}
              segments={focusSegments}
              focus
              changePct={focus?.changePct}
              previousValue={focus?.previousAvailable ? focus.previousValue : null}
            />
            <BenchmarkBar
              label="Measured competitor average"
              value={average ?? 0}
              available={average !== null}
              maxValue={maxValue}
              metric={metric}
              segments={competitorSegments}
            />
          </div>

          {legendPlatforms.length > 0 ? (
            <ul className="mt-4 flex flex-wrap gap-x-3 gap-y-1.5" aria-label="Platform breakdown">
              {legendPlatforms.map((candidate) => (
                <li key={candidate} className="inline-flex items-center gap-1.5 text-[10px] text-zinc-500 dark:text-zinc-400">
                  <span
                    className="h-2 w-2 rounded-sm"
                    style={{ backgroundColor: PLATFORM_COLORS[candidate] }}
                    aria-hidden
                  />
                  {PLATFORM_LABELS[candidate]}
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      </div>
    </Panel>
  );
}
