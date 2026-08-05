import { METRIC_DEFS } from '@/lib/metrics/definitions';
import { parseDateValue, REPORT_TIME_ZONE } from '@/lib/dates';
import type { MetricKey } from '@/lib/types';
import { compactNumber } from '@/lib/utils';

/**
 * Metric formatting, driven entirely by the metric dictionary so that a number
 * looks the same everywhere it appears. 'compact' is for tiles and axes where
 * space is short; 'full' is for tables, where an executive may want the digits.
 */
export function formatMetric(
  value: number | null | undefined,
  metric: MetricKey,
  mode: 'compact' | 'full' = 'compact',
): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return '—';
  const def = METRIC_DEFS[metric];

  if (def.unit === 'percent') {
    const pct = value * 100;
    if (Math.abs(pct) >= 1000) return Math.round(pct).toLocaleString('en-US') + '%';
    return pct.toFixed(def.precision) + '%';
  }

  if (def.unit === 'rate') {
    if (mode === 'compact' && Math.abs(value) >= 10000) return compactNumber(value);
    return value.toLocaleString('en-US', {
      minimumFractionDigits: def.precision,
      maximumFractionDigits: def.precision,
    });
  }

  if (mode === 'compact') return compactNumber(value);
  return Math.round(value).toLocaleString('en-US');
}

/** Signed variant, for net-change style figures where the sign is the point. */
export function formatSigned(value: number | null | undefined, metric: MetricKey): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return '—';
  const body = formatMetric(Math.abs(value), metric);
  if (value === 0) return body;
  return (value > 0 ? '+' : '−') + body;
}

export function formatInteger(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return '—';
  return Math.round(value).toLocaleString('en-US');
}

export function formatUsd(value: number | null | undefined, digits = 2): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return '—';
  return value.toLocaleString('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
}

const DATE_FMT = new Intl.DateTimeFormat('en-US', {
  month: 'short', day: 'numeric', timeZone: REPORT_TIME_ZONE,
});
const DATE_TIME_FMT = new Intl.DateTimeFormat('en-US', {
  month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit',
  timeZone: REPORT_TIME_ZONE,
});
const FULL_FMT = new Intl.DateTimeFormat('en-US', {
  year: 'numeric', month: 'short', day: 'numeric', timeZone: REPORT_TIME_ZONE,
});

export function formatDate(value: string | Date | null | undefined): string {
  if (!value) return '—';
  const d = parseDateValue(value);
  return Number.isNaN(+d) ? '—' : DATE_FMT.format(d);
}

export function formatDateTime(value: string | Date | null | undefined): string {
  if (!value) return '—';
  const d = parseDateValue(value);
  return Number.isNaN(+d) ? '—' : DATE_TIME_FMT.format(d);
}

export function formatFullDate(value: string | Date | null | undefined): string {
  if (!value) return '—';
  const d = parseDateValue(value);
  return Number.isNaN(+d) ? '—' : FULL_FMT.format(d);
}

/** "3 hours ago" style, capped at a week before falling back to a date. */
export function formatRelative(value: string | Date | null | undefined): string {
  if (!value) return 'never';
  const d = parseDateValue(value);
  if (Number.isNaN(+d)) return 'never';
  const secs = Math.round((Date.now() - d.getTime()) / 1000);
  if (secs < 60) return 'just now';
  if (secs < 3600) return Math.floor(secs / 60) + 'm ago';
  if (secs < 86400) return Math.floor(secs / 3600) + 'h ago';
  if (secs < 604800) return Math.floor(secs / 86400) + 'd ago';
  return formatDate(d);
}

export function truncate(text: string, max: number): string {
  if (text.length <= max) return text;
  return text.slice(0, max).trimEnd() + '…';
}
