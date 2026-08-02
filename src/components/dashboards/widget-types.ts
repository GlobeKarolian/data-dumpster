import { METRIC_KEYS, PLATFORMS, type MetricKey, type Platform } from '@/lib/types';

/**
 * The dashboard widget vocabulary.
 *
 * The API validates only the envelope on purpose, so this file is the real
 * contract. Everything a widget needs to render is in the definition: no widget
 * reaches for ambient page state, which is what lets the same renderer serve a
 * signed-in dashboard and a public share link with no branching.
 */
export const WIDGET_TYPES = [
  'stat',
  'focusSummary',
  'leaderboard',
  'table',
  'scatter',
  'timeseries',
  'platformMix',
  'topPosts',
  'cadence',
  'note',
] as const;
export type WidgetType = (typeof WIDGET_TYPES)[number];

export interface WidgetDef {
  id: string;
  type: WidgetType;
  title?: string;
  metric?: MetricKey;
  /** Horizontal-axis metric for a company comparison scatter plot. */
  xMetric?: MetricKey;
  platform?: Platform;
  /** Columns spanned in the twelve-column grid. */
  span?: 4 | 6 | 8 | 12;
  /** Body text, for the note widget. */
  text?: string;
}

export const WIDGET_CATALOG: { type: WidgetType; label: string; description: string; defaultSpan: 4 | 6 | 8 | 12 }[] = [
  { type: 'stat', label: 'Stat tile', description: 'One headline number with its delta and sparkline.', defaultSpan: 4 },
  { type: 'focusSummary', label: 'At a glance', description: 'The focus company’s four headline metrics in one compact panel.', defaultSpan: 12 },
  { type: 'leaderboard', label: 'Leaderboard', description: 'Every company ranked on one metric, with the competitive average.', defaultSpan: 6 },
  { type: 'table', label: 'Metrics table', description: 'Every company’s value, prior-period delta, and channel breakdown.', defaultSpan: 12 },
  { type: 'scatter', label: 'Metric comparison', description: 'Plot every company on two defined metrics to expose scale and efficiency.', defaultSpan: 8 },
  { type: 'timeseries', label: 'Trend', description: 'One metric over time, one line per company.', defaultSpan: 8 },
  { type: 'platformMix', label: 'Platform mix', description: 'Where the focus company’s weight sits, by channel.', defaultSpan: 4 },
  { type: 'topPosts', label: 'Top posts', description: 'The best post on each channel in the window.', defaultSpan: 12 },
  { type: 'cadence', label: 'Posting cadence', description: 'Seven days by twenty-four hours, by volume.', defaultSpan: 6 },
  { type: 'note', label: 'Note', description: 'Written context so a dashboard can carry its own explanation.', defaultSpan: 6 },
];

const TYPE_SET = new Set<string>(WIDGET_TYPES);
const METRIC_SET = new Set<string>(METRIC_KEYS);
const PLATFORM_SET = new Set<string>(PLATFORMS);
const SPANS = new Set([4, 6, 8, 12]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Read stored widgets defensively; an unknown type is dropped, never rendered blank. */
export function parseWidgets(raw: unknown): WidgetDef[] {
  if (!Array.isArray(raw)) return [];
  const out: WidgetDef[] = [];
  raw.forEach((item, i) => {
    if (!isRecord(item)) return;
    const type = typeof item.type === 'string' && TYPE_SET.has(item.type) ? (item.type as WidgetType) : null;
    if (!type) return;
    const span = typeof item.span === 'number' && SPANS.has(item.span) ? (item.span as 4 | 6 | 8 | 12) : undefined;
    out.push({
      id: typeof item.id === 'string' && item.id ? item.id : type + '-' + i,
      type,
      title: typeof item.title === 'string' ? item.title : undefined,
      metric:
        typeof item.metric === 'string' && METRIC_SET.has(item.metric) ? (item.metric as MetricKey) : undefined,
      xMetric:
        typeof item.xMetric === 'string' && METRIC_SET.has(item.xMetric)
          ? (item.xMetric as MetricKey)
          : undefined,
      platform:
        typeof item.platform === 'string' && PLATFORM_SET.has(item.platform)
          ? (item.platform as Platform)
          : undefined,
      span: span ?? WIDGET_CATALOG.find((w) => w.type === type)?.defaultSpan,
      text: typeof item.text === 'string' ? item.text : undefined,
    });
  });
  return out;
}

export const SPAN_CLASS: Record<4 | 6 | 8 | 12, string> = {
  4: 'lg:col-span-4',
  6: 'lg:col-span-6',
  8: 'lg:col-span-8',
  12: 'lg:col-span-12',
};
