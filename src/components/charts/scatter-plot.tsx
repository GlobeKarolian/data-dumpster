'use client';

import * as React from 'react';
import {
  CartesianGrid, ResponsiveContainer, Scatter, ScatterChart, Tooltip, XAxis, YAxis, ZAxis,
  type TooltipContentProps,
} from 'recharts';
import { PLATFORM_LABELS, type Platform } from '@/lib/types';
import { compactNumber } from '@/lib/utils';
import type { PostDto } from '@/lib/metrics/contract';
import { formatDateTime, truncate } from '@/components/ui/format';
import { ChartFrame, ChartTooltipCard } from './chart-frame';
import { CHART_HEIGHT, axisProps, gridProps, platformColor } from './theme';

interface Point {
  x: number;
  y: number;
  z: number;
  id: string;
  company: string;
  platform: Platform;
  text: string;
  permalink: string | null;
  outlierScore: number | null;
}

export interface ScatterPlotProps {
  posts: PostDto[];
  height?: number;
  /** Log-scale the engagement axis; social engagement is heavily skewed. */
  logScale?: boolean;
  emptyHint?: string;
}

/**
 * Every post in the window: when it went out, how hard it landed, and how big
 * the audience was when it did. The bubble size is what stops this from being a
 * chart of "who has the most followers" wearing a different hat.
 */
export function ScatterPlot({ posts, height = CHART_HEIGHT.tall, logScale, emptyHint }: ScatterPlotProps) {
  const byPlatform = React.useMemo(() => {
    const groups = new Map<Platform, Point[]>();
    for (const p of posts) {
      const t = new Date(p.postedAt).getTime();
      if (Number.isNaN(t)) continue;
      const y = logScale ? Math.max(p.engagementTotal, 1) : p.engagementTotal;
      const list = groups.get(p.platform) ?? [];
      list.push({
        x: t,
        y,
        z: p.followersAtPost ?? 0,
        id: p.id,
        company: p.company.name,
        platform: p.platform,
        text: p.text ? truncate(p.text, 90) : 'Untitled post',
        permalink: p.permalink,
        outlierScore: p.outlierScore,
      });
      groups.set(p.platform, list);
    }
    return [...groups.entries()];
  }, [posts, logScale]);

  const maxAudience = posts.reduce((m, p) => Math.max(m, p.followersAtPost ?? 0), 0);

  return (
    <ChartFrame
      height={height}
      isEmpty={byPlatform.length === 0}
      emptyLabel="No posts in this window"
      emptyHint={emptyHint ?? 'Each dot is one post. Widen the window or clear a filter to bring some in.'}
    >
      <ResponsiveContainer width="100%" height="100%">
        <ScatterChart margin={{ top: 12, right: 16, bottom: 4, left: 4 }}>
          <CartesianGrid {...gridProps} />
          <XAxis
            type="number"
            dataKey="x"
            domain={['dataMin', 'dataMax']}
            {...axisProps}
            minTickGap={40}
            tickFormatter={(v: number) =>
              new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric' }).format(new Date(v))
            }
            name="Posted"
          />
          <YAxis
            type="number"
            dataKey="y"
            {...axisProps}
            width={48}
            scale={logScale ? 'log' : 'auto'}
            domain={logScale ? [1, 'dataMax'] : [0, 'dataMax']}
            allowDataOverflow={false}
            tickFormatter={(v: number) => compactNumber(v)}
            name="Engagement"
          />
          <ZAxis type="number" dataKey="z" range={[24, 320]} domain={[0, Math.max(maxAudience, 1)]} name="Audience" />
          <Tooltip
            cursor={{ strokeDasharray: '3 3', stroke: 'var(--pb-grid)' }}
            content={(props: TooltipContentProps) => {
              if (!props.active || !props.payload?.length) return null;
              const d = props.payload[0].payload as Point;
              return (
                <div className="max-w-xs">
                  <ChartTooltipCard
                    title={d.company + ' · ' + PLATFORM_LABELS[d.platform]}
                    rows={[
                      { label: 'Posted', value: formatDateTime(new Date(d.x)) },
                      { label: 'Engagement', value: compactNumber(d.y), color: platformColor(d.platform) },
                      { label: 'Audience at post', value: d.z > 0 ? compactNumber(d.z) : 'not recorded' },
                      ...(d.outlierScore && d.outlierScore > 3
                        ? [{ label: 'Outlier', value: d.outlierScore.toFixed(1) + 'x median' }]
                        : []),
                    ]}
                  />
                  <p className="mt-1 rounded border border-zinc-200 bg-white px-2 py-1 text-[11px] leading-relaxed text-zinc-600 shadow-lg dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-400">
                    {d.text}
                  </p>
                </div>
              );
            }}
          />
          {byPlatform.map(([platform, points]) => (
            <Scatter
              key={platform}
              name={PLATFORM_LABELS[platform]}
              data={points}
              fill={platformColor(platform)}
              fillOpacity={0.55}
              stroke={platformColor(platform)}
              strokeOpacity={0.9}
              isAnimationActive={false}
            />
          ))}
        </ScatterChart>
      </ResponsiveContainer>
    </ChartFrame>
  );
}
