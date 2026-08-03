import * as React from 'react';
import type {
  ActivityPoint,
  AtAGlance,
  CompanyActivityRow,
} from '@/lib/metrics/content-analysis';
import { MetricLabel } from '@/components/ui/metric-label';
import { cn } from '@/lib/utils';

function pct(value: number): string {
  return (value * 100).toFixed(value < 0.001 ? 3 : 2) + '%';
}

function compact(value: number): string {
  return value.toLocaleString('en-US', {
    maximumFractionDigits: value < 10 ? 1 : 0,
  });
}

type PerformanceMetric = 'engagementRateByFollower' | 'engagementPerPost';

/**
 * Null is an em dash. It means no post carried a follower reading, which is a
 * different statement from a rate that was measured and came out at zero.
 */
function formatPerformance(value: number | null, metric: PerformanceMetric): string {
  if (value === null) return '—';
  return metric === 'engagementPerPost' ? compact(value) : pct(value);
}

function Headline({
  metric,
  label,
  value,
  comparison,
}: {
  metric: 'posts' | PerformanceMetric;
  label: string;
  value: string;
  comparison: string;
}) {
  return (
    <div className="min-w-0 px-4 py-3">
      <p className="text-[10px] font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
        <MetricLabel metric={metric} text={label} />
      </p>
      <p className="pb-num mt-1 text-2xl font-semibold tabular-nums tracking-tight text-zinc-900 dark:text-zinc-50">
        {value}
      </p>
      <p className="mt-0.5 text-[11px] text-zinc-500 dark:text-zinc-400">
        {comparison}
      </p>
    </div>
  );
}

export function ActivitySummary({
  glance,
  rows,
  totalPosts,
  companyCount,
  publicationLabel,
  rateLabel,
  performanceMetric = 'engagementRateByFollower',
  showBenchmark = true,
}: {
  glance: AtAGlance;
  rows: CompanyActivityRow[];
  totalPosts: number;
  companyCount: number;
  publicationLabel: string;
  rateLabel: string;
  performanceMetric?: PerformanceMetric;
  showBenchmark?: boolean;
}) {
  const focusPosts = rows.find((row) => row.focus)?.posts ?? 0;
  const landscapeAverage = totalPosts / Math.max(1, companyCount);
  const focusPerformance = performanceMetric === 'engagementPerPost'
    ? glance.engagementPerPost
    : glance.engagementRateByFollower;
  const landscapePerformance = performanceMetric === 'engagementPerPost'
    ? glance.landscapeEngagementPerPost
    : glance.landscapeEngagementRate;
  const comparison = showBenchmark ? null : 'Add competitor accounts to benchmark';

  return (
    <div className="grid grid-cols-2 divide-x divide-zinc-200 border-b border-zinc-200 dark:divide-zinc-800 dark:border-zinc-800">
      <Headline
        metric="posts"
        label={`Your ${publicationLabel} in period`}
        value={focusPosts.toLocaleString('en-US')}
        comparison={comparison ?? `Landscape average ${compact(landscapeAverage)}`}
      />
      <Headline
        metric={performanceMetric}
        label={`Your ${rateLabel}`}
        value={formatPerformance(focusPerformance, performanceMetric)}
        comparison={comparison
          ?? `Landscape average ${formatPerformance(landscapePerformance, performanceMetric)}`}
      />
    </div>
  );
}

export function ActivityTable({
  rows,
  publicationLabel = 'Posts',
  rateLabel = 'Eng. rate by follower',
  performanceMetric = 'engagementRateByFollower',
}: {
  rows: CompanyActivityRow[];
  publicationLabel?: string;
  rateLabel?: string;
  performanceMetric?: PerformanceMetric;
}) {
  const performanceValue = (row: CompanyActivityRow): number | null => row[performanceMetric];
  const maxRate = Math.max(0.000001, ...rows.map((r) => performanceValue(r) ?? 0));

  if (rows.length === 0) {
    return (
      <p className="py-8 text-center text-xs text-zinc-500">
        No company activity in this window.
      </p>
    );
  }

  return (
    <div className="max-h-[25rem] overflow-auto">
      <table className="w-full text-xs">
        <thead className="sticky top-0 z-10 bg-white dark:bg-zinc-900">
          <tr className="text-[10px] uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
            <th scope="col" className="px-3 py-2 text-left font-normal">Company</th>
            <th scope="col" className="px-2 py-2 text-right font-normal">
              <MetricLabel metric="posts" text={publicationLabel} align="end" />
            </th>
            <th scope="col" className="px-3 py-2 text-left font-normal">
              <MetricLabel metric={performanceMetric} text={rateLabel} />
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row, index) => (
            <tr
              key={row.companyId}
              className={cn(
                'border-t border-zinc-100 dark:border-zinc-800/60',
                row.focus && 'bg-accent-50/60 dark:bg-accent-950/15',
              )}
            >
              <td className="max-w-[14rem] px-3 py-2 text-zinc-900 dark:text-zinc-100">
                <span className="flex min-w-0 items-center gap-2">
                  <span className="pb-num w-5 shrink-0 text-right tabular-nums text-zinc-400">
                    {index + 1}
                  </span>
                  <span className={cn('truncate', row.focus && 'font-semibold')}>
                    {row.companyName}
                  </span>
                </span>
              </td>
              <td className="pb-num px-2 py-2 text-right tabular-nums text-zinc-600 dark:text-zinc-300">
                {row.posts.toLocaleString('en-US')}
              </td>
              <td className="px-3 py-2">
                <span className="flex min-w-32 items-center gap-2">
                  <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-zinc-100 dark:bg-zinc-800">
                    <span
                      className={cn(
                        'block h-full rounded-full',
                        row.focus ? 'bg-accent-600' : 'bg-zinc-400 dark:bg-zinc-500',
                      )}
                      style={{
                        width: `${(() => {
                          const v = performanceValue(row);
                          return v === null ? 0 : Math.max(v > 0 ? 2 : 0, (v / maxRate) * 100);
                        })()}%`,
                      }}
                    />
                  </span>
                  <span className="pb-num w-14 shrink-0 text-right tabular-nums text-zinc-600 dark:text-zinc-300">
                    {formatPerformance(performanceValue(row), performanceMetric)}
                  </span>
                </span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function dateLabel(value: string): string {
  const date = new Date(value + 'T12:00:00');
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function axisValue(value: number, metric: 'posts' | PerformanceMetric): string {
  if (metric === 'engagementRateByFollower') return pct(value);
  return compact(value);
}

function Trend({
  points,
  focusName,
  publicationLabel,
  rateLabel,
  metric,
  showBenchmark,
}: {
  points: ActivityPoint[];
  focusName: string;
  publicationLabel: string;
  rateLabel: string;
  metric: 'posts' | PerformanceMetric;
  showBenchmark: boolean;
}) {
  const width = 640;
  const height = 154;
  const padLeft = 48;
  const padRight = 8;
  const padTop = 10;
  const padBottom = 24;
  const innerWidth = width - padLeft - padRight;
  const innerHeight = height - padTop - padBottom;
  const focus = points.map((point) =>
    metric === 'posts'
      ? point.focusPosts
      : metric === 'engagementPerPost'
        ? point.focusEngagementPerPost
        : point.focusRate);
  const market = points.map((point) =>
    metric === 'posts'
      ? point.landscapePostsPerCompany
      : metric === 'engagementPerPost'
        ? point.landscapeEngagementPerPost
        : point.landscapeRate);
  const max = Math.max(
    metric === 'engagementRateByFollower' ? 0.000001 : 1,
    ...focus,
    ...(showBenchmark ? market : []),
  );
  const x = (index: number) =>
    padLeft + (points.length <= 1 ? innerWidth / 2 : (index / (points.length - 1)) * innerWidth);
  const y = (value: number) => padTop + innerHeight - (value / max) * innerHeight;
  const path = (values: number[]) => values
    .map((value, index) =>
      `${index === 0 ? 'M' : 'L'}${x(index).toFixed(1)} ${y(value).toFixed(1)}`)
    .join(' ');
  const labelEvery = Math.max(1, Math.ceil(points.length / 6));
  const title = metric === 'posts'
    ? `${publicationLabel} per day`
    : rateLabel;

  return (
    <figure className="py-4 first:pt-0 last:pb-0">
      <figcaption className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <span className="text-[10px] font-semibold uppercase tracking-wide text-zinc-600 dark:text-zinc-300">
          <MetricLabel
            metric={metric === 'posts' ? 'postsPerDay' : metric}
            text={title}
          />
        </span>
        <span className="flex flex-wrap items-center gap-3 text-[10px] text-zinc-500">
          <span className="inline-flex items-center gap-1">
            <span className="h-0.5 w-3 bg-accent-600" />
            {focusName}
          </span>
          {showBenchmark ? (
            <span className="inline-flex items-center gap-1">
              <span className="h-0.5 w-3 border-t border-dashed border-zinc-400" />
              Landscape average
            </span>
          ) : null}
        </span>
      </figcaption>
      <svg
        viewBox={`0 0 ${width} ${height}`}
        className="h-[154px] w-full"
        role="img"
        aria-label={showBenchmark
          ? `${title} for ${focusName} compared with the landscape average`
          : `${title} for ${focusName}`}
      >
        {[0, 0.5, 1].map((fraction) => {
          const value = max * (1 - fraction);
          const lineY = padTop + innerHeight * fraction;
          return (
            <React.Fragment key={fraction}>
              <line
                x1={padLeft}
                x2={width - padRight}
                y1={lineY}
                y2={lineY}
                className="stroke-zinc-100 dark:stroke-zinc-800"
                strokeWidth={1}
              />
              <text
                x={padLeft - 7}
                y={lineY + 3}
                textAnchor="end"
                className="fill-zinc-400 text-[9px]"
              >
                {axisValue(value, metric)}
              </text>
            </React.Fragment>
          );
        })}
        {showBenchmark ? (
          <path
            d={path(market)}
            fill="none"
            strokeWidth={1.25}
            strokeDasharray="4 3"
            className="stroke-zinc-400 dark:stroke-zinc-500"
          />
        ) : null}
        <path d={path(focus)} fill="none" strokeWidth={1.75} stroke="#C8102E" />
        {points.map((point, index) => (
          index % labelEvery === 0 || index === points.length - 1 ? (
            <text
              key={point.date}
              x={x(index)}
              y={height - 4}
              textAnchor={index === 0 ? 'start' : index === points.length - 1 ? 'end' : 'middle'}
              className="fill-zinc-400 text-[9px]"
            >
              {dateLabel(point.date)}
            </text>
          ) : null
        ))}
      </svg>
    </figure>
  );
}

export function ActivityTrends({
  points,
  focusName,
  publicationLabel = 'Posts',
  rateLabel = 'Eng. rate by follower',
  performanceMetric = 'engagementRateByFollower',
  showBenchmark = true,
}: {
  points: ActivityPoint[];
  focusName: string;
  publicationLabel?: string;
  rateLabel?: string;
  performanceMetric?: PerformanceMetric;
  showBenchmark?: boolean;
}) {
  if (points.length === 0) {
    return (
      <p className="py-8 text-center text-xs text-zinc-500">
        No activity trend in this window.
      </p>
    );
  }

  return (
    <div className="divide-y divide-zinc-200 dark:divide-zinc-800">
      <Trend
        points={points}
        focusName={focusName}
        publicationLabel={publicationLabel}
        rateLabel={rateLabel}
        metric="posts"
        showBenchmark={showBenchmark}
      />
      <Trend
        points={points}
        focusName={focusName}
        publicationLabel={publicationLabel}
        rateLabel={rateLabel}
        metric={performanceMetric}
        showBenchmark={showBenchmark}
      />
    </div>
  );
}
