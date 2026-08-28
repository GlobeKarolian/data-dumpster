import {
  METRIC_KEYS,
  PLATFORMS,
  type Granularity,
  type MetricKey,
  type Platform,
} from '@/lib/types';

/**
 * The block vocabulary: one definition, three hosts.
 *
 * A block is the unit a dashboard widget, a report section and a scheduled
 * export all render. The dashboard already obeyed the rule that a widget
 * carries everything it needs and never reaches for ambient page state; this
 * model keeps that rule and extends it to the two report hosts, so the same
 * JSON renders identically on a signed-in dashboard, a public share link, a
 * stored report document and a PowerPoint slide.
 *
 * Why a separate model rather than reusing `WidgetDef` directly: a report
 * needs fields a live dashboard never did — an explicit focus-vs-landscape
 * scope, time grouping, a benchmark overlay, and a verified narrative body.
 * Widening `WidgetDef` with report-only optional fields would let a dashboard
 * silently persist a half-configured report block. A distinct, versioned
 * `BlockDefinition` keeps each host honest: `parseBlocks` drops anything it
 * cannot render, exactly as `parseWidgets` does today.
 *
 * The relationship to `WidgetDef` is deliberate and one-directional: every
 * dashboard widget type maps to a block type, so an existing dashboard can be
 * expressed as blocks without loss. The reverse is not true — `narrative` and
 * `storyCluster` have no dashboard widget analogue yet.
 */

export const BLOCK_TYPES = [
  'stat',
  'focusSummary',
  'leaderboard',
  'table',
  'scatter',
  'timeseries',
  'platformMix',
  'topPosts',
  'cadence',
  'bar',
  'pie',
  'note',
  'narrative',
  'storyCluster',
] as const;
export type BlockType = (typeof BLOCK_TYPES)[number];

/** Focus company measured alone, or the whole landscape measured together. */
export const BLOCK_SCOPES = ['focus', 'landscape'] as const;
export type BlockScope = (typeof BLOCK_SCOPES)[number];

/**
 * The benchmark line a chart overlays, matching Rival IQ's Compare Against
 * and extending it with a fixed target. `none` renders no overlay.
 */
export const BLOCK_BENCHMARKS = [
  'none',
  'competitorAverage',
  'competitorMedian',
  'landscapeAverage',
  'landscapeMedian',
  'target',
] as const;
export type BlockBenchmark = (typeof BLOCK_BENCHMARKS)[number];

export interface BlockDefinition {
  id: string;
  type: BlockType;
  /** Schema version, so a stored document can be migrated forward on read. */
  v: 1;
  title?: string;
  scope?: BlockScope;
  metric?: MetricKey;
  /** Horizontal-axis metric for a two-metric scatter. */
  xMetric?: MetricKey;
  platform?: Platform;
  /** Time bucketing for series and cadence blocks. */
  granularity?: Granularity;
  benchmark?: BlockBenchmark;
  /** The fixed value a `target` benchmark draws. */
  benchmarkTarget?: number;
  /** Columns spanned in the twelve-column grid. */
  span?: 4 | 6 | 8 | 12;
  /** Body text for note and narrative blocks. */
  text?: string;
}

export interface BlockCatalogEntry {
  type: BlockType;
  label: string;
  description: string;
  defaultSpan: 4 | 6 | 8 | 12;
  /** Which scope the block measures; `either` renders in both. */
  scope: BlockScope | 'either';
  /** True when the block carries prose rather than a computed metric. */
  textual: boolean;
}

export const BLOCK_CATALOG: BlockCatalogEntry[] = [
  { type: 'stat', label: 'Stat tile', description: 'One headline number with its delta and sparkline.', defaultSpan: 4, scope: 'either', textual: false },
  { type: 'focusSummary', label: 'At a glance', description: 'The focus company’s four headline metrics in one compact panel.', defaultSpan: 12, scope: 'focus', textual: false },
  { type: 'leaderboard', label: 'Leaderboard', description: 'Every company ranked on one metric, with the competitive average.', defaultSpan: 6, scope: 'landscape', textual: false },
  { type: 'table', label: 'Metrics table', description: 'Every company’s value, prior-period delta, and channel breakdown.', defaultSpan: 12, scope: 'landscape', textual: false },
  { type: 'scatter', label: 'Metric comparison', description: 'Plot every company on two defined metrics to expose scale and efficiency.', defaultSpan: 8, scope: 'landscape', textual: false },
  { type: 'timeseries', label: 'Trend', description: 'One metric over time, one line per company.', defaultSpan: 8, scope: 'either', textual: false },
  { type: 'bar', label: 'Bar chart', description: 'One metric across companies, stacked or grouped, with an optional benchmark line.', defaultSpan: 8, scope: 'landscape', textual: false },
  { type: 'pie', label: 'Pie chart', description: 'Share of one metric across the landscape or the focus company’s channels.', defaultSpan: 6, scope: 'either', textual: false },
  { type: 'platformMix', label: 'Platform mix', description: 'Where the focus company’s weight sits, by channel.', defaultSpan: 4, scope: 'focus', textual: false },
  { type: 'topPosts', label: 'Top posts', description: 'The best post on each channel in the window.', defaultSpan: 12, scope: 'either', textual: false },
  { type: 'cadence', label: 'Posting cadence', description: 'Seven days by twenty-four hours, by volume.', defaultSpan: 6, scope: 'either', textual: false },
  { type: 'note', label: 'Note', description: 'Written context so a dashboard can carry its own explanation.', defaultSpan: 6, scope: 'either', textual: true },
  { type: 'narrative', label: 'Verified narrative', description: 'AI prose checked against a code-computed fact sheet before it renders.', defaultSpan: 12, scope: 'either', textual: true },
  { type: 'storyCluster', label: 'Story clusters', description: 'The stories that mattered in the window, clustered across companies.', defaultSpan: 12, scope: 'landscape', textual: false },
];

const TYPE_SET = new Set<string>(BLOCK_TYPES);
const SCOPE_SET = new Set<string>(BLOCK_SCOPES);
const BENCHMARK_SET = new Set<string>(BLOCK_BENCHMARKS);
const METRIC_SET = new Set<string>(METRIC_KEYS);
const PLATFORM_SET = new Set<string>(PLATFORMS);
const GRANULARITY_SET = new Set<string>(['day', 'week', 'month']);
const SPANS = new Set([4, 6, 8, 12]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function catalogEntry(type: BlockType): BlockCatalogEntry | undefined {
  return BLOCK_CATALOG.find((entry) => entry.type === type);
}

/**
 * Read stored blocks defensively; an unknown type or malformed field is
 * dropped, never rendered blank. This is the same contract `parseWidgets`
 * honours for dashboards, applied to every host that renders a block.
 */
export function parseBlocks(raw: unknown): BlockDefinition[] {
  if (!Array.isArray(raw)) return [];
  const out: BlockDefinition[] = [];
  raw.forEach((item, i) => {
    if (!isRecord(item)) return;
    const type =
      typeof item.type === 'string' && TYPE_SET.has(item.type) ? (item.type as BlockType) : null;
    if (!type) return;
    const span =
      typeof item.span === 'number' && SPANS.has(item.span) ? (item.span as 4 | 6 | 8 | 12) : undefined;
    const benchmark =
      typeof item.benchmark === 'string' && BENCHMARK_SET.has(item.benchmark)
        ? (item.benchmark as BlockBenchmark)
        : undefined;
    out.push({
      id: typeof item.id === 'string' && item.id ? item.id : type + '-' + i,
      type,
      v: 1,
      title: typeof item.title === 'string' ? item.title : undefined,
      scope:
        typeof item.scope === 'string' && SCOPE_SET.has(item.scope)
          ? (item.scope as BlockScope)
          : undefined,
      metric:
        typeof item.metric === 'string' && METRIC_SET.has(item.metric)
          ? (item.metric as MetricKey)
          : undefined,
      xMetric:
        typeof item.xMetric === 'string' && METRIC_SET.has(item.xMetric)
          ? (item.xMetric as MetricKey)
          : undefined,
      platform:
        typeof item.platform === 'string' && PLATFORM_SET.has(item.platform)
          ? (item.platform as Platform)
          : undefined,
      granularity:
        typeof item.granularity === 'string' && GRANULARITY_SET.has(item.granularity)
          ? (item.granularity as Granularity)
          : undefined,
      benchmark,
      benchmarkTarget:
        benchmark === 'target' && typeof item.benchmarkTarget === 'number'
          ? item.benchmarkTarget
          : undefined,
      span: span ?? catalogEntry(type)?.defaultSpan,
      text: typeof item.text === 'string' ? item.text : undefined,
    });
  });
  return out;
}

export const BLOCK_SPAN_CLASS: Record<4 | 6 | 8 | 12, string> = {
  4: 'lg:col-span-4',
  6: 'lg:col-span-6',
  8: 'lg:col-span-8',
  12: 'lg:col-span-12',
};
