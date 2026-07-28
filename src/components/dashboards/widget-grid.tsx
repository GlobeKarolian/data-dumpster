import * as React from 'react';
import { LayoutDashboard } from 'lucide-react';
import type { AnalyticsQuery, CompanyRef, MetricKey } from '@/lib/types';
import type { MetricsApi, SummaryResult } from '@/lib/metrics/contract';
import { METRIC_DEFS } from '@/lib/metrics/definitions';
import { PLATFORM_COLORS } from '@/lib/types';
import { Panel } from '@/components/common/panel';
import { EmptyState } from '@/components/ui/empty-state';
import { StatTile } from '@/components/ui/stat-tile';
import { BarLeaderboard } from '@/components/charts/bar-leaderboard';
import { TimeSeriesChart } from '@/components/charts/time-series-chart';
import { HeatmapGrid } from '@/components/charts/heatmap-grid';
import { PlatformMixPanel } from '@/components/overview/platform-mix';
import { TopPostsPanel } from '@/components/overview/top-posts';
import { SPAN_CLASS, type WidgetDef } from './widget-types';

export interface WidgetGridProps {
  widgets: WidgetDef[];
  /** Base query for the dashboard's landscape and window. */
  query: AnalyticsQuery & { orgId?: string };
  companies: CompanyRef[];
  focusCompanyId: string | null;
  api: MetricsApi;
  /** Hides edit affordances; used by the public share view. */
  readOnly?: boolean;
}

function headlineFor(summary: SummaryResult | null, metric: MetricKey) {
  if (!summary) return null;
  if (metric === 'audience') return summary.headline.audience;
  if (metric === 'posts') return summary.headline.posts;
  if (metric === 'engagementRateByFollower') return summary.headline.engagementRateByFollower;
  return summary.headline.engagementTotal;
}

function seriesDefs(companies: CompanyRef[], focusCompanyId: string | null) {
  const palette = ['#2563EB', '#0D9488', '#D97706', '#7C3AED', '#DB2777', '#65A30D', '#0891B2', '#4F46E5'];
  return companies.map((c, i) => ({
    key: c.id,
    label: c.name,
    color: c.id === focusCompanyId ? '#C8102E' : (c.color ?? palette[i % palette.length]),
    emphasis: c.id === focusCompanyId,
  }));
}

/**
 * Renders a saved widget layout. Each widget states everything it needs, so the
 * same component backs both the authenticated dashboard and the public share
 * link — a shared dashboard is the same render, not a second implementation
 * that can drift from the first.
 */
export async function WidgetGrid({
  widgets,
  query,
  companies,
  focusCompanyId,
  api,
  readOnly,
}: WidgetGridProps) {
  if (widgets.length === 0) {
    return (
      <EmptyState
        icon={LayoutDashboard}
        title="This dashboard has no widgets"
        description={
          readOnly
            ? 'Nothing has been added to this dashboard yet.'
            : 'Add a widget from the toolbar above. A dashboard is worth building when a specific question gets asked every week.'
        }
      />
    );
  }

  const needsSummary = widgets.some((w) => ['stat', 'platformMix', 'topPosts'].includes(w.type));
  const cadenceWidgets = widgets.some((w) => w.type === 'cadence');

  const [summary, cadence] = await Promise.all([
    needsSummary ? api.getSummary({ ...query, compare: true }).catch(() => null) : Promise.resolve(null),
    cadenceWidgets ? api.getPostingCadence(query).catch(() => []) : Promise.resolve([]),
  ]);

  const rendered = await Promise.all(
    widgets.map(async (widget) => {
      const metric = widget.metric ?? 'engagementTotal';
      const scoped = widget.platform ? { ...query, platforms: [widget.platform] } : query;
      const accent = widget.platform ? PLATFORM_COLORS[widget.platform] : undefined;

      if (widget.type === 'leaderboard') {
        const rows = await api.getLeaderboard({ ...scoped, metric, compare: true }).catch(() => []);
        return (
          <Panel
            key={widget.id}
            metric={metric}
            title={widget.title ?? METRIC_DEFS[metric].label}
            note={METRIC_DEFS[metric].caveat}
          >
            <BarLeaderboard rows={rows} metric={metric} focusCompanyId={focusCompanyId} color={accent} />
          </Panel>
        );
      }

      if (widget.type === 'timeseries') {
        const series = await api
          .getTimeSeries({ ...scoped, metric })
          .catch(() => ({ series: [], companies: [], granularity: 'day' as const }));
        return (
          <Panel key={widget.id} metric={metric} title={widget.title ?? METRIC_DEFS[metric].label + ' over time'}>
            <TimeSeriesChart
              data={series.series}
              series={seriesDefs(companies, focusCompanyId)}
              metric={metric}
              granularity={series.granularity}
            />
          </Panel>
        );
      }

      if (widget.type === 'stat') {
        const stat = headlineFor(summary, metric);
        return (
          <StatTile
            key={widget.id}
            metric={metric}
            value={stat?.value ?? null}
            previousValue={stat?.previousValue ?? null}
            changePct={stat?.changePct ?? null}
            spark={stat?.spark}
            label={widget.title}
            color={accent}
          />
        );
      }

      if (widget.type === 'platformMix') {
        return <PlatformMixPanel key={widget.id} summary={summary} />;
      }

      if (widget.type === 'topPosts') {
        return <TopPostsPanel key={widget.id} posts={summary?.topPosts ?? []} title={widget.title ?? 'Top post by channel'} />;
      }

      if (widget.type === 'cadence') {
        return (
          <Panel key={widget.id} title={widget.title ?? 'Posting cadence'}>
            <HeatmapGrid cells={cadence} color={accent ?? '#C8102E'} />
          </Panel>
        );
      }

      return (
        <Panel key={widget.id} title={widget.title ?? 'Note'}>
          <p className="whitespace-pre-wrap text-sm leading-relaxed text-zinc-600 dark:text-zinc-400">
            {widget.text ?? 'No text yet.'}
          </p>
        </Panel>
      );
    }),
  );

  return (
    <div className="grid grid-cols-1 gap-3 lg:grid-cols-12">
      {widgets.map((widget, i) => (
        <div key={widget.id} className={SPAN_CLASS[widget.span ?? 6]}>
          {rendered[i]}
        </div>
      ))}
    </div>
  );
}
