'use client';

import * as React from 'react';
import {
  Bar, BarChart, Cell, LabelList, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts';
import { ChartFrame, ChartTooltipCard } from '@/components/charts/chart-frame';
import { ACCENT, CHART_MUTED, axisProps } from '@/components/charts/theme';
import { categoryForLabel } from '@/lib/reports/referral-platforms';
import { cn } from '@/lib/utils';

/**
 * Two views of the same import, because the table answers only one question.
 *
 * Ranked by volume the chart says Google and nothing else, which is true and
 * useless: it is the answer every week. The second view divides subscriptions
 * by visits and surfaces the sources that punch above their traffic, which is
 * where a platforms team can actually act. Neither is the whole picture, so
 * both are one click apart rather than one of them being chosen for the reader.
 */
type View = 'volume' | 'efficiency';

/** Below this the rate is noise, matching the threshold the table applies. */
const MIN_CONVERSIONS_FOR_RATE = 5;

function fmtInt(n: number): string {
  return n.toLocaleString('en-US');
}

function fmtPct(n: number | null): string {
  return n === null ? '—' : (n * 100).toFixed(3) + '%';
}

type Point = {
  label: string; subs: number; visits: number; rate: number | null; isAi: boolean;
};

/** "723,823" and "1.279%" back to numbers. Grouping separators are display only. */
function num(cell: string | undefined): number {
  const n = Number((cell ?? '').replace(/[,%\s]/g, ''));
  return Number.isFinite(n) ? n : 0;
}

/**
 * Read the saved table rather than the import result.
 *
 * The rows are what persists, so deriving from them is what makes the chart
 * survive a reload. It also means a figure corrected by hand in the grid is
 * reflected here instead of the chart and the table quietly disagreeing.
 */
function toPoints(rows: string[][]): Point[] {
  return rows
    .filter((r) => r[0] && !/^All other referrers/i.test(r[0]))
    .map((r) => {
      const visits = num(r[1]);
      const subs = num(r[2]);
      const shown = (r[3] ?? '').trim();
      return {
        label: r[0],
        subs,
        visits,
        // An em dash means the rate was withheld as too small to be meaningful.
        rate: shown === '' || shown === '—' ? null : num(r[3]) / 100,
        isAi: categoryForLabel(r[0]) === 'ai',
      };
    });
}

export function ReferralChart({ rows }: { rows: string[][] }) {
  const [view, setView] = React.useState<View>('volume');
  const points = React.useMemo(() => toPoints(rows), [rows]);

  const volume = React.useMemo(
    () => [...points].sort((a, b) => b.subs - a.subs).slice(0, 10),
    [points],
  );

  /**
   * Efficiency deliberately re-filters rather than reusing the volume slice.
   * Ranking by rate over a list already cut to the top ten by volume would
   * quietly guarantee the answer is a big platform, which is the bias the view
   * exists to remove.
   */
  const efficiency = React.useMemo(
    () => points
      .filter((p) => p.subs >= MIN_CONVERSIONS_FOR_RATE && p.rate !== null)
      .sort((a, b) => (b.rate ?? 0) - (a.rate ?? 0))
      .slice(0, 10),
    [points],
  );

  const data = view === 'volume' ? volume : efficiency;
  const isEmpty = data.length === 0;

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-[11px] leading-relaxed text-zinc-500 dark:text-zinc-400">
          {view === 'volume'
            ? 'New subscriptions by platform, largest first.'
            : `Subscriptions per logged-out visit. Platforms under ${MIN_CONVERSIONS_FOR_RATE} `
              + 'conversions are excluded, since a rate built on one or two is noise.'}
        </p>
        <div
          role="tablist"
          aria-label="Chart view"
          className="flex shrink-0 items-center gap-0.5 rounded-md bg-zinc-100 p-0.5 dark:bg-zinc-800"
        >
          {(['volume', 'efficiency'] as const).map((v) => (
            <button
              key={v}
              type="button"
              role="tab"
              aria-selected={view === v}
              onClick={() => setView(v)}
              className={cn(
                'rounded px-2 py-1 text-[11px] font-medium transition-colors',
                view === v
                  ? 'bg-white text-zinc-900 shadow-sm dark:bg-zinc-900 dark:text-zinc-100'
                  : 'text-zinc-500 hover:text-zinc-800 dark:text-zinc-400 dark:hover:text-zinc-200',
              )}
            >
              {v === 'volume' ? 'By volume' : 'By conversion'}
            </button>
          ))}
        </div>
      </div>

      <ChartFrame
        height={Math.max(160, data.length * 28 + 24)}
        isEmpty={isEmpty}
        emptyLabel="Nothing to chart yet"
        emptyHint="Import the referral export above and this fills in."
      >
        <ResponsiveContainer width="100%" height="100%">
          <BarChart
            data={data}
            layout="vertical"
            margin={{ top: 4, right: 56, bottom: 4, left: 4 }}
            barCategoryGap={6}
          >
            <XAxis type="number" hide />
            <YAxis
              type="category"
              dataKey="label"
              width={132}
              {...axisProps}
              interval={0}
            />
            <Tooltip
              cursor={{ fill: 'var(--pb-grid)', fillOpacity: 0.35 }}
              content={({ active, payload }) => {
                if (!active || !payload?.length) return null;
                const d = payload[0].payload as (typeof data)[number];
                return (
                  <ChartTooltipCard
                    title={d.label}
                    rows={[
                      { label: 'New subscriptions', value: fmtInt(d.subs) },
                      { label: 'Logged-out visits', value: fmtInt(d.visits) },
                      {
                        label: 'Conversion',
                        value: d.subs >= MIN_CONVERSIONS_FOR_RATE ? fmtPct(d.rate) : '—',
                      },
                    ]}
                  />
                );
              }}
            />
            <Bar
              dataKey={view === 'volume' ? 'subs' : 'rate'}
              radius={[0, 3, 3, 0]}
              isAnimationActive={false}
            >
              {data.map((d) => (
                // AI referrers take the accent in the conversion view because
                // they are the finding it exists to make visible.
                <Cell
                  key={d.label}
                  fill={view === 'efficiency' && d.isAi ? ACCENT : CHART_MUTED}
                />
              ))}
              <LabelList
                dataKey={view === 'volume' ? 'subs' : 'rate'}
                position="right"
                className="pb-num"
                fill="var(--pb-label)"
                fontSize={11}
                formatter={(v) => {
                  const n = Number(v);
                  if (!Number.isFinite(n)) return '';
                  return view === 'volume' ? fmtInt(n) : (n * 100).toFixed(2) + '%';
                }}
              />
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </ChartFrame>
    </div>
  );
}
