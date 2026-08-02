'use client';

import * as React from 'react';
import {
  CartesianGrid,
  Cell,
  LabelList,
  ReferenceLine,
  ResponsiveContainer,
  Scatter,
  ScatterChart,
  Tooltip,
  XAxis,
  YAxis,
  type TooltipContentProps,
} from 'recharts';
import type { CompanyRef, MetricKey, MetricRow } from '@/lib/types';
import { METRIC_DEFS } from '@/lib/metrics/definitions';
import { formatMetric } from '@/components/ui/format';
import { ChartFrame, ChartTooltipCard } from '@/components/charts/chart-frame';
import { ACCENT, axisProps, companyColor, gridProps } from '@/components/charts/theme';

interface Point {
  id: string;
  name: string;
  shortName: string;
  company: CompanyRef;
  x: number;
  y: number;
  fill: string;
  isFocus: boolean;
}

function shortName(name: string): string {
  return name.length > 20 ? name.slice(0, 18).trimEnd() + '…' : name;
}

export function MetricScatterWidget({
  xRows,
  yRows,
  xMetric,
  yMetric,
  focusCompanyId,
}: {
  xRows: MetricRow[];
  yRows: MetricRow[];
  xMetric: MetricKey;
  yMetric: MetricKey;
  focusCompanyId: string | null;
}) {
  const data = React.useMemo(() => {
    const yByCompany = new Map(yRows.map((row) => [row.company.id, row]));
    return xRows.flatMap((xRow, index): Point[] => {
      const yRow = yByCompany.get(xRow.company.id);
      if (
        !yRow
        || !xRow.available
        || !yRow.available
        || !Number.isFinite(xRow.value)
        || !Number.isFinite(yRow.value)
      ) return [];
      const isFocus = xRow.company.id === focusCompanyId;
      return [{
        id: xRow.company.id,
        name: xRow.company.name,
        shortName: shortName(xRow.company.name),
        company: xRow.company,
        x: xRow.value,
        y: yRow.value,
        fill: isFocus ? ACCENT : companyColor(xRow.company, index, focusCompanyId),
        isFocus,
      }];
    });
  }, [focusCompanyId, xRows, yRows]);

  const hasSignal = data.some((point) => point.x !== 0 || point.y !== 0);

  return (
    <ChartFrame
      height={360}
      isEmpty={data.length === 0 || !hasSignal}
      emptyLabel={data.length === 0 ? 'No companies in this landscape' : 'Both metrics are zero in this window'}
      emptyHint="Choose another metric pair or widen the date range."
    >
      <ResponsiveContainer width="100%" height="100%">
        <ScatterChart margin={{ top: 24, right: 24, bottom: 12, left: 8 }}>
          <CartesianGrid {...gridProps} />
          <XAxis
            type="number"
            dataKey="x"
            name={xMetric}
            domain={['auto', 'auto']}
            {...axisProps}
            height={34}
            tickFormatter={(value: number) => formatMetric(value, xMetric)}
          />
          <YAxis
            type="number"
            dataKey="y"
            name={yMetric}
            domain={['auto', 'auto']}
            {...axisProps}
            width={58}
            tickFormatter={(value: number) => formatMetric(value, yMetric)}
          />
          <ReferenceLine x={0} stroke="var(--pb-reference)" strokeOpacity={0.55} />
          <ReferenceLine y={0} stroke="var(--pb-reference)" strokeOpacity={0.55} />
          <Tooltip
            cursor={{ strokeDasharray: '3 3', stroke: 'var(--pb-grid)' }}
            content={(props: TooltipContentProps) => {
              if (!props.active || !props.payload?.length) return null;
              const point = props.payload[0].payload as Point;
              return (
                <ChartTooltipCard
                  title={point.name}
                  rows={[
                    {
                      label: METRIC_DEFS[xMetric].label,
                      value: formatMetric(point.x, xMetric, 'full'),
                      color: point.fill,
                    },
                    {
                      label: METRIC_DEFS[yMetric].label,
                      value: formatMetric(point.y, yMetric, 'full'),
                      color: point.fill,
                    },
                  ]}
                />
              );
            }}
          />
          <Scatter data={data} isAnimationActive={false}>
            {data.map((point) => (
              <Cell
                key={point.id}
                fill={point.fill}
                fillOpacity={point.isFocus ? 1 : 0.72}
                stroke={point.isFocus ? ACCENT : point.fill}
                strokeWidth={point.isFocus ? 2 : 1}
              />
            ))}
            <LabelList
              dataKey="shortName"
              position="top"
              offset={7}
              style={{ fill: 'var(--pb-label)', fontSize: 10 }}
            />
          </Scatter>
        </ScatterChart>
      </ResponsiveContainer>
    </ChartFrame>
  );
}
