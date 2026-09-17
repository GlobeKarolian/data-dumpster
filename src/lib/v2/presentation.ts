import { METRIC_DEFS } from '@/lib/metrics/definitions';
import type { MetricKey, MetricRow } from '@/lib/types';
export function metricText(key: MetricKey, value: number | null | undefined, available = true): string {
  if (!available || value == null || !Number.isFinite(value)) return '—';
  const def = METRIC_DEFS[key];
  return new Intl.NumberFormat('en-US', { minimumFractionDigits: def.precision, maximumFractionDigits: def.precision }).format(value * (def.unit === 'percent' ? 100 : 1)) + (def.unit === 'percent' ? '%' : '');
}
export function deltaText(row: MetricRow): string {
  if (!row.available || row.complete !== true || !row.previousAvailable || row.previousComplete !== true || !row.previousValue || row.previousValue < 0 || row.changeFromRoundedSource || row.changePct == null || !Number.isFinite(row.changePct)) return '—';
  return `${row.changePct > 0 ? '+' : ''}${(row.changePct * 100).toFixed(1)}%`;
}
export function qualityLabel(row: Pick<MetricRow, 'available' | 'complete'>): string {
  return !row.available ? 'Unavailable' : row.complete === true ? 'Complete' : 'Observed only';
}
export function neighborId(ids: string[], selected: string, direction: 1 | -1): string | null {
  const index = ids.indexOf(selected);
  return index < 0 ? null : ids[index + direction] ?? null;
}
export function mayNavigate(tagName: string, editable: boolean): boolean {
  return !editable && !['INPUT', 'TEXTAREA', 'SELECT', 'BUTTON', 'A', 'SUMMARY'].includes(tagName.toUpperCase());
}
/** Post DTOs do not expose counter availability. Zero is therefore withheld. */
export function observedCounter(value: number): string { return metricText('posts', value, value > 0); }
export function safeWebUrl(value: string | null | undefined): string | null {
  if (!value) return null;
  try { const u = new URL(value); return ['https:', 'http:'].includes(u.protocol) ? value : null; } catch { return null; }
}
export function timestamp(value: string | Date): string {
  const d = new Date(value);
  return Number.isFinite(+d) ? new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZoneName: 'short' }).format(d) : 'Unknown';
}
