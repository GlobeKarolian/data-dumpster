import * as React from 'react';
import type { RateByBucket } from '@/lib/metrics/content-analysis';

/**
 * Activity and engagement rate across a time axis, focus against landscape.
 *
 * Two series on one plot rather than two charts: the whole question is whether
 * you are publishing when the audience is actually there, and that only reads
 * when both lines share an axis. Bars are volume, the line is rate, because
 * they have different units and stacking them would be a lie.
 *
 * Drawn as bare SVG rather than through the chart library. Twenty-four points
 * with a single line does not need a dependency, and this renders on the server
 * with no hydration cost.
 */
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

function label(bucket: number, kind: 'hour' | 'weekday'): string {
  if (kind === 'weekday') return DAYS[bucket] ?? '';
  if (bucket === 0) return '12a';
  if (bucket === 12) return '12p';
  return bucket < 12 ? bucket + 'a' : (bucket - 12) + 'p';
}

export function TimesChart({
  data,
  kind,
}: {
  data: RateByBucket[];
  kind: 'hour' | 'weekday';
}) {
  const w = 640;
  const h = 150;
  const padL = 8;
  const padB = 18;
  const inner = w - padL * 2;
  const step = inner / data.length;

  const maxPosts = Math.max(1, ...data.map((d) => d.focusPosts));
  const maxRate = Math.max(0.0001, ...data.map((d) => Math.max(d.focusRate, d.landscapeRate)));

  const y = (rate: number) => (h - padB) - (rate / maxRate) * (h - padB - 10);
  const x = (i: number) => padL + i * step + step / 2;

  const line = (pick: (d: RateByBucket) => number) =>
    data.map((d, i) => (i === 0 ? 'M' : 'L') + x(i).toFixed(1) + ' ' + y(pick(d)).toFixed(1)).join(' ');

  const everyOther = kind === 'hour' ? 3 : 1;

  return (
    <svg viewBox={'0 0 ' + w + ' ' + h} className="h-[150px] w-full" role="img"
      aria-label={'Posting volume and engagement rate by ' + kind}
    >
      {data.map((d, i) => {
        const bh = (d.focusPosts / maxPosts) * (h - padB - 12);
        return (
          <rect
            key={d.bucket}
            x={padL + i * step + step * 0.2}
            y={h - padB - bh}
            width={step * 0.6}
            height={Math.max(0, bh)}
            rx={1.5}
            className="fill-zinc-200 dark:fill-zinc-800"
          />
        );
      })}

      <path d={line((d) => d.landscapeRate)} fill="none" strokeWidth={1.25}
        strokeDasharray="3 3" className="stroke-zinc-400 dark:stroke-zinc-500" />
      <path d={line((d) => d.focusRate)} fill="none" strokeWidth={1.75} stroke="#C8102E" />

      {data.map((d, i) => (
        i % everyOther === 0 ? (
          <text key={d.bucket} x={x(i)} y={h - 5} textAnchor="middle"
            className="fill-zinc-400 text-[9px]"
          >
            {label(d.bucket, kind)}
          </text>
        ) : null
      ))}
    </svg>
  );
}
