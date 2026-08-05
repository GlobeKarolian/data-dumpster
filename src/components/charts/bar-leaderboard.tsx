'use client';

import * as React from 'react';
import {
  Bar, BarChart, Cell, LabelList, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis,
  type TooltipContentProps,
} from 'recharts';
import {
  PLATFORMS, PLATFORM_LABELS, type MetricKey, type MetricRow, type Platform,
} from '@/lib/types';
import { compactNumber, formatChange } from '@/lib/utils';
import { measuredCompetitorAverage } from '@/lib/metrics/availability';
import { formatMetric } from '@/components/ui/format';
import { PlatformIcon } from '@/components/ui/platform-icon';
import { ChartFrame, ChartTooltipCard } from './chart-frame';
import { ACCENT, companyColor, platformColor } from './theme';

export interface BarLeaderboardProps {
  rows: MetricRow[];
  metric: MetricKey;
  /** The company the landscape is written from. Drawn in the accent. */
  focusCompanyId?: string | null;
  /** Draws the competitor mean as a dashed reference line. */
  showCompetitorAverage?: boolean;
  maxRows?: number;
  emptyHint?: string;
  /** Force a color for every bar, e.g. a platform brand color. */
  color?: string;
  /** Use the per-platform values already carried by MetricRow. */
  showPlatformBreakdown?: boolean;
}

interface Datum {
  id: string;
  name: string;
  value: number;
  previousValue: number | null;
  changePct: number | null;
  available: boolean;
  complete: boolean;
  valueLabel: string;
  breakdown: Partial<Record<Platform, number>>;
  isFocus: boolean;
  fill: string;
}

const ADDITIVE_BREAKDOWN_METRICS = new Set<MetricKey>([
  'audience',
  'audienceNetChange',
  'posts',
  'postsPerDay',
  'postsPerWeek',
  'engagementTotal',
  'applause',
  'conversation',
  'amplification',
  'saves',
  'views',
]);

function valueLabel(value: number, metric: MetricKey, changePct: number | null): string {
  const change = changePct === null ? '' : '  ' + formatChange(changePct).label;
  return formatMetric(value, metric) + change;
}

/**
 * Horizontal leaderboard.
 *
 * The focus company is the only bar in the accent, and the dashed line is the
 * mean of everyone else. That line is the whole point: a rank tells you the
 * order, but only the distance from the competitive average tells you whether
 * the order matters.
 */
export function BarLeaderboard({
  rows,
  metric,
  focusCompanyId,
  showCompetitorAverage = true,
  maxRows = 12,
  emptyHint,
  color,
  showPlatformBreakdown = false,
}: BarLeaderboardProps) {
  const [expanded, setExpanded] = React.useState(false);
  const measuredRows = React.useMemo(
    () => rows.filter((row) => row.available),
    [rows],
  );
  const visibleRowLimit = expanded ? measuredRows.length : maxRows;
  const data: Datum[] = React.useMemo(
    () =>
      measuredRows.slice(0, visibleRowLimit).map((r, i) => {
        const isFocus = Boolean(focusCompanyId && r.company.id === focusCompanyId);
        const availableBreakdown = Object.fromEntries(
          Object.entries(r.breakdown ?? {}).filter(([platform]) =>
            r.breakdownAvailability?.[platform as Platform] !== false),
        ) as Partial<Record<Platform, number>>;
        return {
          id: r.company.id,
          name: r.company.name,
          value: Number.isFinite(r.value) ? r.value : 0,
          available: r.available,
          complete: r.complete !== false,
          previousValue: r.previousValue ?? null,
          changePct: r.changePct ?? null,
          valueLabel: r.available
            ? valueLabel(
                Number.isFinite(r.value) ? r.value : 0,
                metric,
                r.changePct ?? null,
              )
            : '—',
          breakdown: availableBreakdown,
          isFocus,
          fill: isFocus ? ACCENT : (color ?? companyColor(r.company, i, focusCompanyId)),
        };
      }),
    [measuredRows, visibleRowLimit, focusCompanyId, color, metric],
  );

  const average = showCompetitorAverage
    ? measuredCompetitorAverage(rows, focusCompanyId)
    : null;

  const breakdownPlatforms = React.useMemo(
    () => PLATFORMS.filter((platform) =>
      data.some((d) => {
        const value = d.breakdown[platform];
        return value !== undefined && Number.isFinite(value) && value !== 0;
      })),
    [data],
  );
  const useStackedBreakdown =
    showPlatformBreakdown
    && ADDITIVE_BREAKDOWN_METRICS.has(metric)
    && breakdownPlatforms.length > 0;

  const hasMeasuredValue = measuredRows.length > 0;
  const hasSignal = measuredRows.some((row) => row.value !== 0);
  const needsAudienceHistory =
    metric === 'audienceNetChange' || metric === 'audienceGrowthRate';
  const isEmpty = rows.length === 0 || !hasMeasuredValue || !hasSignal;
  const height = isEmpty
    ? 120
    : Math.max(120, data.length * 26 + 28);
  const hasMore = measuredRows.length > maxRows;

  return (
    <div>
      {useStackedBreakdown ? (
        <div
          aria-label="Platform breakdown"
          className="mb-2 flex flex-wrap items-center justify-end gap-x-3 gap-y-1 px-1 text-[10px] leading-none text-zinc-600 dark:text-zinc-400"
        >
          {breakdownPlatforms.map((platform) => (
            <span key={platform} className="inline-flex items-center gap-1 whitespace-nowrap">
              <PlatformIcon platform={platform} className="h-2.5 w-2.5" />
              <span>{PLATFORM_LABELS[platform]}</span>
            </span>
          ))}
        </div>
      ) : null}
      <ChartFrame
        height={height}
        isEmpty={isEmpty}
        emptyLabel={
          rows.length === 0
            ? 'No companies in this landscape'
            : !hasMeasuredValue
              ? 'Not enough observations to compute this metric'
              : 'Every measured company is zero here'
        }
        emptyHint={
          emptyHint ??
          (rows.length === 0
            ? 'Add companies and channels, then run an ingest to populate this leaderboard.'
            : !hasMeasuredValue
              ? needsAudienceHistory
                ? 'Audience change needs at least two snapshots. Missing history stays blank.'
                : 'This metric is not available from the selected channels in this window.'
            : 'Nothing was published or measured in this window. Widen the date range to check.')
        }
      >
        <ResponsiveContainer width="100%" height="100%">
          <BarChart
            data={data}
            layout="vertical"
            stackOffset="sign"
            margin={{ top: average !== null ? 18 : 2, right: 104, bottom: 0, left: 0 }}
          >
          <XAxis
            type="number"
            hide
            domain={[
              (minimum: number) => Math.min(0, minimum),
              (maximum: number) => Math.max(0, maximum),
            ]}
          />
          <YAxis
            type="category"
            dataKey="name"
            width={132}
            tickLine={false}
            axisLine={false}
            tick={{ fill: 'var(--pb-label)', fontSize: 11 }}
            interval={0}
          />
          <Tooltip
            cursor={{ fill: 'var(--pb-grid)', fillOpacity: 0.35 }}
            content={(props: TooltipContentProps) => {
              if (!props.active || !props.payload?.length) return null;
              const d = props.payload[0].payload as Datum;
              const rowsOut = [
                {
                  label: 'This window',
                  value: d.available ? formatMetric(d.value, metric, 'full') : 'Not available',
                  color: d.fill,
                },
              ];
              rowsOut.push({
                label: 'Coverage',
                value: d.complete ? 'Complete window' : 'Partial window',
                color: d.complete ? '#15803D' : '#B45309',
              });
              if (d.previousValue !== null) {
                rowsOut.push({
                  label: 'Previous window',
                  value: formatMetric(d.previousValue, metric, 'full'),
                  color: 'var(--pb-muted-series)',
                });
              }
              rowsOut.push({
                label: 'Change',
                value: formatChange(d.changePct).label,
                color:
                  d.changePct === null || d.changePct === 0
                    ? 'var(--pb-muted-series)'
                    : d.changePct > 0 ? '#15803D' : '#B91C1C',
              });
              if (showPlatformBreakdown) {
                for (const platform of breakdownPlatforms) {
                  const value = d.breakdown[platform];
                  if (value === undefined) continue;
                  rowsOut.push({
                    label: PLATFORM_LABELS[platform],
                    value: formatMetric(value, metric, 'full'),
                    color: platformColor(platform),
                  });
                }
              }
              if (average !== null) {
                rowsOut.push({
                  label: 'Competitor average',
                  value: formatMetric(average, metric, 'full'),
                  color: 'var(--pb-reference)',
                });
              }
              return <ChartTooltipCard title={d.name} rows={rowsOut} />;
            }}
          />
          {average !== null ? (
            <ReferenceLine
              x={average}
              stroke="var(--pb-reference)"
              strokeDasharray="4 3"
              strokeWidth={1}
              label={{
                value: 'avg ' + compactNumber(average),
                position: 'top',
                fill: 'var(--pb-label)',
                fontSize: 10,
              }}
            />
          ) : null}
          {useStackedBreakdown ? (
            <>
              {breakdownPlatforms.map((platform, platformIndex) => (
                <Bar
                  key={platform}
                  dataKey={(d: Datum) => d.breakdown[platform] ?? 0}
                  name={PLATFORM_LABELS[platform]}
                  stackId="platform"
                  fill={platformColor(platform)}
                  barSize={14}
                  isAnimationActive={false}
                >
                  {data.map((d) => (
                    <Cell
                      key={d.id}
                      fill={platformColor(platform)}
                      fillOpacity={d.isFocus ? 1 : 0.72}
                    />
                  ))}
                  {platformIndex === breakdownPlatforms.length - 1 ? (
                    <LabelList
                      dataKey="valueLabel"
                      position="right"
                      style={{
                        fill: 'var(--pb-label)',
                        fontSize: 10,
                        fontVariantNumeric: 'tabular-nums',
                      }}
                    />
                  ) : null}
                </Bar>
              ))}
            </>
          ) : (
            <Bar dataKey="value" radius={[0, 2, 2, 0]} barSize={14} isAnimationActive={false}>
              {data.map((d) => (
                <Cell key={d.id} fill={d.fill} fillOpacity={d.isFocus ? 1 : 0.75} />
              ))}
              <LabelList
                dataKey="valueLabel"
                position="right"
                style={{
                  fill: 'var(--pb-label)',
                  fontSize: 10,
                  fontVariantNumeric: 'tabular-nums',
                }}
              />
            </Bar>
          )}
          </BarChart>
        </ResponsiveContainer>
      </ChartFrame>
      {hasMore && !isEmpty ? (
        <div className="mt-2 flex justify-end border-t border-zinc-100 pt-2 dark:border-zinc-800">
          <button
            type="button"
            onClick={() => setExpanded((value) => !value)}
            className="rounded px-2 py-1 text-[11px] font-medium text-zinc-500 transition-colors hover:bg-zinc-100 hover:text-zinc-900 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-zinc-100"
          >
            {expanded ? 'Show top ' + maxRows : 'View all ' + measuredRows.length}
          </button>
        </div>
      ) : null}
    </div>
  );
}
