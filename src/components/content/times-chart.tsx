import * as React from 'react';
import type { RateByBucket } from '@/lib/metrics/content-analysis';
import { MetricLabel } from '@/components/ui/metric-label';

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

function bucketLabel(bucket: number, kind: 'hour' | 'weekday'): string {
  if (kind === 'weekday') return DAYS[bucket] ?? '';
  if (bucket === 0) return '12am';
  if (bucket === 12) return '12pm';
  return bucket < 12 ? `${bucket}am` : `${bucket - 12}pm`;
}

function pct(value: number): string {
  return (value * 100).toFixed(value < 0.001 ? 3 : 2) + '%';
}

function number(value: number): string {
  return value.toLocaleString('en-US', {
    maximumFractionDigits: value < 10 ? 1 : 0,
  });
}

export function TimesChart({
  data,
  kind,
  metric,
  focusName,
  publicationLabel,
  days,
  companyCount,
  showBenchmark = true,
}: {
  data: RateByBucket[];
  kind: 'hour' | 'weekday';
  metric: 'activity' | 'rate' | 'engagementPerPost';
  focusName: string;
  publicationLabel: string;
  days: number;
  companyCount: number;
  showBenchmark?: boolean;
}) {
  const width = 640;
  const height = 178;
  const padLeft = 48;
  const padRight = 10;
  const padTop = 10;
  const padBottom = 28;
  const innerWidth = width - padLeft - padRight;
  const innerHeight = height - padTop - padBottom;
  const safeDays = Math.max(1, days);
  const safeCompanies = Math.max(1, companyCount);
  const activityPeriods = kind === 'hour' ? safeDays : safeDays / 7;
  const focus = data.map((point) => metric === 'activity'
    ? point.focusPosts / activityPeriods
    : metric === 'engagementPerPost'
      ? point.focusEngagementPerPost
      : point.focusRate);
  const landscape = data.map((point) => metric === 'activity'
    ? point.landscapePosts / activityPeriods / safeCompanies
    : metric === 'engagementPerPost'
      ? point.landscapeEngagementPerPost
      : point.landscapeRate);
  const max = Math.max(
    metric === 'rate' ? 0.000001 : 1,
    ...focus.map((v) => v ?? 0),
    ...(showBenchmark ? landscape.map((v) => v ?? 0) : []),
  );
  const step = data.length > 1 ? innerWidth / (data.length - 1) : innerWidth;
  const x = (index: number) =>
    padLeft + (data.length <= 1 ? innerWidth / 2 : index * step);
  const y = (value: number) =>
    padTop + innerHeight - (value / max) * innerHeight;
  const path = (values: (number | null)[]) => {
    let drawing = false;
    return values.map((value, index) => {
      if (value === null) {
        drawing = false;
        return '';
      }
      const command = drawing ? 'L' : 'M';
      drawing = true;
      return `${command}${x(index).toFixed(1)} ${y(value).toFixed(1)}`;
    }).filter(Boolean).join(' ');
  };
  const labelEvery = kind === 'hour' ? 4 : 1;
  const axisValue = metric === 'rate' ? pct : number;
  const title = metric === 'activity'
    ? `Average activity by published ${kind === 'hour' ? 'hour' : 'day'} (EST)`
    : metric === 'engagementPerPost'
      ? `Average engagement per post by published ${kind === 'hour' ? 'hour' : 'day'} (EST)`
      : `Average engagement rate by published ${kind === 'hour' ? 'hour' : 'day'} (EST)`;
  const metricKey = metric === 'rate'
    ? 'engagementRateByFollower'
    : metric === 'engagementPerPost'
      ? 'engagementPerPost'
    : kind === 'hour'
      ? 'postsPerDay'
      : 'postsPerWeek';

  if (data.length === 0) {
    return (
      <div className="p-4">
        <p className="text-[10px] font-semibold uppercase tracking-wide text-zinc-600 dark:text-zinc-300">
          {title}
        </p>
        <p className="py-12 text-center text-xs text-zinc-500">
          No publishing-time data in this window.
        </p>
      </div>
    );
  }

  return (
    <figure className="min-w-0 p-4">
      <figcaption className="mb-3">
        <p className="text-[10px] font-semibold uppercase tracking-wide text-zinc-600 dark:text-zinc-300">
          <MetricLabel metric={metricKey} text={title} />
        </p>
        <p className="mt-1 flex flex-wrap items-center gap-3 text-[10px] text-zinc-500">
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
        </p>
      </figcaption>
      <svg
        viewBox={`0 0 ${width} ${height}`}
        className="h-[178px] w-full"
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
                {axisValue(value)}
              </text>
            </React.Fragment>
          );
        })}

        {showBenchmark ? (
          <path
            d={path(landscape)}
            fill="none"
            strokeWidth={1.25}
            strokeDasharray="4 3"
            className="stroke-zinc-400 dark:stroke-zinc-500"
          />
        ) : null}
        <path d={path(focus)} fill="none" strokeWidth={1.75} stroke="#C8102E" />

        {data.map((point, index) => (
          index % labelEvery === 0 || index === data.length - 1 ? (
            <text
              key={point.bucket}
              x={x(index)}
              y={height - 5}
              textAnchor={
                index === 0 ? 'start' : index === data.length - 1 ? 'end' : 'middle'
              }
              className="fill-zinc-400 text-[9px]"
            >
              {bucketLabel(point.bucket, kind)}
            </text>
          ) : null
        ))}
      </svg>
      <p className="mt-1 text-[10px] text-zinc-500">
        {metric === 'activity'
          ? kind === 'hour'
            ? `Average ${publicationLabel.toLowerCase()} per day at each hour.`
            : `Average ${publicationLabel.toLowerCase()} per seven-day period on each weekday.`
          : metric === 'engagementPerPost'
            ? 'Engagement divided by posts in each publishing-time bucket.'
            : 'Posts without a follower reading are excluded from both rate series.'}
      </p>
    </figure>
  );
}
