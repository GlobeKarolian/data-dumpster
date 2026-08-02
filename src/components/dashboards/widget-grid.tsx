import * as React from 'react';
import { LayoutDashboard } from 'lucide-react';
import type { AnalyticsQuery, CompanyRef, MetricKey, MetricRow } from '@/lib/types';
import type { HeadlineStat, MetricsApi, SummaryResult, TimeSeriesResult } from '@/lib/metrics/contract';
import { METRIC_DEFS } from '@/lib/metrics/definitions';
import { PLATFORM_COLORS, PLATFORM_LABELS } from '@/lib/types';
import { companiesInScope, effectiveFocusCompanyId } from '@/lib/analytics-scope';
import { platformMetricLabel, publicationNoun } from '@/lib/platform-language';
import { Panel } from '@/components/common/panel';
import { EmptyState } from '@/components/ui/empty-state';
import { MiniStat, StatTile } from '@/components/ui/stat-tile';
import { MetricLabel } from '@/components/ui/metric-label';
import { BarLeaderboard } from '@/components/charts/bar-leaderboard';
import { TimeSeriesChart } from '@/components/charts/time-series-chart';
import { HeatmapGrid } from '@/components/charts/heatmap-grid';
import { PlatformMixPanel } from '@/components/overview/platform-mix';
import { TopPostsPanel } from '@/components/overview/top-posts';
import { MetricScatterWidget } from './metric-scatter-widget';
import { MetricTableWidget } from './metric-table-widget';
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
  if (metric === 'engagementTotal') return summary.headline.engagementTotal;
  if (metric === 'engagementRateByFollower') return summary.headline.engagementRateByFollower;
  return null;
}

function seriesDefs(companies: CompanyRef[], focusCompanyId: string | null) {
  const palette = ['#2563EB', '#0D9488', '#D97706', '#7C3AED', '#DB2777', '#65A30D', '#0891B2', '#4F46E5'];
  const ordered = [...companies].sort((a, b) => {
    if (a.id === focusCompanyId) return -1;
    if (b.id === focusCompanyId) return 1;
    return a.name.localeCompare(b.name);
  });
  return ordered.map((c, i) => ({
    key: c.id,
    label: c.name,
    color: c.id === focusCompanyId ? '#C8102E' : (c.color ?? palette[i % palette.length]),
    emphasis: c.id === focusCompanyId,
  }));
}

interface WidgetLoad<T> {
  data: T;
  error: string | null;
}

async function loadWidget<T>(query: Promise<T>, fallback: T): Promise<WidgetLoad<T>> {
  try {
    return { data: await query, error: null };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown dashboard query failure';
    console.error('[pressbox] dashboard widget query failed:', message);
    return { data: fallback, error: message };
  }
}

function FocusSummaryWidget({
  summary,
  title,
  error,
  platform,
}: {
  summary: SummaryResult | null;
  title?: string;
  error?: string | null;
  platform?: WidgetDef['platform'];
}) {
  const headlines: HeadlineStat[] = summary
    ? [
        summary.headline.audience,
        summary.headline.posts,
        summary.headline.engagementTotal,
        summary.headline.engagementRateByFollower,
      ]
    : [];

  return (
    <Panel
      title={title ?? (summary?.focus ? summary.focus.name + ' at a glance' : 'Focus company at a glance')}
      description="Four focus-company headlines, each compared with the immediately preceding window of equal length."
      error={error}
      note={
        summary?.topPlatform
          ? 'Strongest channel by total engagement: ' + PLATFORM_LABELS[summary.topPlatform] + '.'
          : undefined
      }
    >
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {(headlines.length > 0
          ? headlines
          : ([
              { key: 'audience' },
              { key: 'posts' },
              { key: 'engagementTotal' },
              { key: 'engagementRateByFollower' },
            ] as const)
        ).map((headline) => (
          <MiniStat
            key={headline.key}
            metric={headline.key}
            value={
              'value' in headline && headline.available
                ? headline.value
                : null
            }
            changePct={
              'changePct' in headline && headline.available
                ? headline.changePct
                : null
            }
            label={platform ? platformMetricLabel(headline.key, platform) : undefined}
          />
        ))}
      </div>
    </Panel>
  );
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

  const effectiveFocusId = effectiveFocusCompanyId(focusCompanyId, query.companyIds);
  const scopedCompanies = companiesInScope(companies, query.companyIds);

  const summaryCache = new Map<string, Promise<WidgetLoad<SummaryResult | null>>>();
  const leaderboardCache = new Map<string, Promise<WidgetLoad<MetricRow[]>>>();
  const timeSeriesCache = new Map<string, Promise<WidgetLoad<TimeSeriesResult>>>();
  const cadenceCache = new Map<string, Promise<WidgetLoad<Awaited<ReturnType<MetricsApi['getPostingCadence']>>>>>();

  const scopeKey = (widget: WidgetDef) => widget.platform ?? 'all';
  const scopedQuery = (widget: WidgetDef) =>
    widget.platform ? { ...query, platforms: [widget.platform] } : query;

  const summaryFor = (widget: WidgetDef) => {
    const key = scopeKey(widget);
    let pending = summaryCache.get(key);
    if (!pending) {
      pending = loadWidget(
        api.getSummary({ ...scopedQuery(widget), compare: true }),
        null,
      );
      summaryCache.set(key, pending);
    }
    return pending;
  };

  const leaderboardFor = (widget: WidgetDef, metric: MetricKey) => {
    const key = scopeKey(widget) + ':' + metric;
    let pending = leaderboardCache.get(key);
    if (!pending) {
      pending = loadWidget(
        api.getLeaderboard({ ...scopedQuery(widget), metric, compare: true }),
        [],
      );
      leaderboardCache.set(key, pending);
    }
    return pending;
  };

  const timeSeriesFor = (widget: WidgetDef, metric: MetricKey) => {
    const key = scopeKey(widget) + ':' + metric;
    let pending = timeSeriesCache.get(key);
    if (!pending) {
      pending = loadWidget(
        api.getTimeSeries({ ...scopedQuery(widget), metric }),
        { series: [], companies: [], granularity: 'day' as const },
      );
      timeSeriesCache.set(key, pending);
    }
    return pending;
  };

  const cadenceFor = (widget: WidgetDef) => {
    const key = scopeKey(widget);
    let pending = cadenceCache.get(key);
    if (!pending) {
      pending = loadWidget(api.getPostingCadence(scopedQuery(widget)), []);
      cadenceCache.set(key, pending);
    }
    return pending;
  };

  const rendered = await Promise.all(
    widgets.map(async (widget) => {
      const metric = widget.metric ?? 'engagementTotal';
      const accent = widget.platform ? PLATFORM_COLORS[widget.platform] : undefined;
      const metricLabel = widget.platform
        ? platformMetricLabel(metric, widget.platform)
        : METRIC_DEFS[metric].label;

      if (widget.type === 'leaderboard') {
        const result = await leaderboardFor(widget, metric);
        return (
          <Panel
            key={widget.id}
            metric={metric}
            title={widget.title ?? metricLabel}
            note={METRIC_DEFS[metric].caveat}
            error={result.error}
          >
            <BarLeaderboard rows={result.data} metric={metric} focusCompanyId={effectiveFocusId} color={accent} />
          </Panel>
        );
      }

      if (widget.type === 'table') {
        const result = await leaderboardFor(widget, metric);
        return (
          <Panel
            key={widget.id}
            metric={metric}
            title={widget.title ?? metricLabel + ' table'}
            description="Current value, previous-window comparison, and channel breakdown for every company in view."
            note={METRIC_DEFS[metric].caveat}
            bodyClassName="p-0"
            error={result.error}
          >
            <MetricTableWidget
              rows={result.data}
              metric={metric}
              focusCompanyId={effectiveFocusId}
              label={widget.platform ? metricLabel : undefined}
            />
          </Panel>
        );
      }

      if (widget.type === 'scatter') {
        const xMetric = widget.xMetric ?? 'audience';
        const [xResult, yResult] = await Promise.all([
          leaderboardFor(widget, xMetric),
          leaderboardFor(widget, metric),
        ]);
        return (
          <Panel
            key={widget.id}
            title={
              widget.title
              ?? (widget.platform
                ? platformMetricLabel(xMetric, widget.platform)
                  + ' vs. '
                  + platformMetricLabel(metric, widget.platform)
                : METRIC_DEFS[xMetric].shortLabel + ' vs. ' + METRIC_DEFS[metric].shortLabel)
            }
            description={
              <span className="inline-flex flex-wrap items-center gap-1">
                <span>X:</span>
                <MetricLabel
                  metric={xMetric}
                  text={widget.platform ? platformMetricLabel(xMetric, widget.platform) : undefined}
                />
                <span aria-hidden>·</span>
                <span>Y:</span>
                <MetricLabel
                  metric={metric}
                  text={widget.platform ? platformMetricLabel(metric, widget.platform) : undefined}
                />
              </span>
            }
            error={xResult.error ?? yResult.error}
          >
            <MetricScatterWidget
              xRows={xResult.data}
              yRows={yResult.data}
              xMetric={xMetric}
              yMetric={metric}
              focusCompanyId={effectiveFocusId}
            />
          </Panel>
        );
      }

      if (widget.type === 'timeseries') {
        const result = await timeSeriesFor(widget, metric);
        const series = result.data;
        return (
          <Panel
            key={widget.id}
            metric={metric}
            title={widget.title ?? metricLabel + ' over time'}
            error={result.error}
          >
            <TimeSeriesChart
              data={series.series}
              series={seriesDefs(
                series.companies.length > 0 ? series.companies : scopedCompanies,
                effectiveFocusId,
              )}
              metric={metric}
              granularity={series.granularity}
            />
          </Panel>
        );
      }

      if (widget.type === 'stat') {
        const summaryResult = await summaryFor(widget);
        const summary = summaryResult.data;
        if (summaryResult.error) {
          return (
            <Panel
              key={widget.id}
              metric={metric}
              title={widget.title ?? metricLabel}
              error={summaryResult.error}
            >
              <span />
            </Panel>
          );
        }
        const headline = headlineFor(summary, metric);
        let value = headline?.available ? headline.value : null;
        let previousValue = headline?.previousAvailable ? headline.previousValue : null;
        let changePct = headline?.changePct ?? null;
        let spark = headline?.spark;

        if (!headline) {
          const [rowsResult, seriesResult] = await Promise.all([
            leaderboardFor(widget, metric),
            timeSeriesFor(widget, metric),
          ]);
          const queryError = rowsResult.error ?? seriesResult.error;
          if (queryError) {
            return (
              <Panel
                key={widget.id}
                metric={metric}
                title={widget.title ?? metricLabel}
                error={queryError}
              >
                <span />
              </Panel>
            );
          }
          const focusId = summary?.focus?.id ?? effectiveFocusId;
          const row = rowsResult.data.find((item) => item.company.id === focusId);
          value = row?.available ? row.value : null;
          previousValue = row?.previousAvailable ? row.previousValue ?? null : null;
          changePct = row?.changePct ?? null;
          spark = focusId
            ? seriesResult.data.series.flatMap((point) => {
                const pointValue = point[focusId];
                return typeof pointValue === 'number'
                  ? [{ date: String(point.date), value: pointValue }]
                  : [];
              })
            : [];
        }

        return (
          <StatTile
            key={widget.id}
            metric={metric}
            value={value}
            previousValue={previousValue}
            changePct={changePct}
            spark={spark}
            label={widget.title ?? (widget.platform ? metricLabel : undefined)}
            color={accent}
          />
        );
      }

      if (widget.type === 'focusSummary') {
        const result = await summaryFor(widget);
        return (
          <FocusSummaryWidget
            key={widget.id}
            summary={result.data}
            title={widget.title}
            error={result.error}
            platform={widget.platform}
          />
        );
      }

      if (widget.type === 'platformMix') {
        const result = await summaryFor(widget);
        return (
          <PlatformMixPanel
            key={widget.id}
            summary={result.data}
            title={widget.title}
            error={result.error}
          />
        );
      }

      if (widget.type === 'topPosts') {
        const result = await summaryFor(widget);
        return (
          <TopPostsPanel
            key={widget.id}
            posts={result.data?.topPosts ?? []}
            title={
              widget.title
              ?? (widget.platform
                ? 'Top ' + publicationNoun(widget.platform).toLowerCase()
                  + ' on ' + PLATFORM_LABELS[widget.platform]
                : 'Top post by channel')
            }
            error={result.error}
            platform={widget.platform}
            landscapeId={query.landscapeId}
          />
        );
      }

      if (widget.type === 'cadence') {
        const result = await cadenceFor(widget);
        return (
          <Panel
            key={widget.id}
            title={
              widget.title
              ?? (widget.platform ? publicationNoun(widget.platform, false) : 'Post') + ' cadence'
            }
            description={
              widget.platform
                ? 'Darker cells carry more ' + publicationNoun(widget.platform).toLowerCase() + '.'
                : undefined
            }
            error={result.error}
          >
            <HeatmapGrid cells={result.data} color={accent ?? '#C8102E'} />
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
