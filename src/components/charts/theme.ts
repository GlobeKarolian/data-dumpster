import { PLATFORM_COLORS, type Platform } from '@/lib/types';

/**
 * Chart chrome is expressed as CSS custom properties, defined in globals.css and
 * flipped by prefers-color-scheme. Recharts writes these straight into SVG
 * attributes, so dark mode costs no JavaScript and never flashes the wrong
 * palette on hydration.
 */
export const CHART_GRID = 'var(--pb-grid)';
export const CHART_AXIS = 'var(--pb-axis)';
export const CHART_LABEL = 'var(--pb-label)';
export const CHART_REFERENCE = 'var(--pb-reference)';
export const CHART_MUTED = 'var(--pb-muted-series)';

export const ACCENT = '#C8102E';

/**
 * Company series palette. The focus company always takes the accent; the rest
 * are drawn from a set chosen to stay distinguishable on both backgrounds and
 * under the two most common forms of color blindness.
 */
export const SERIES_PALETTE = [
  '#2563EB', '#0D9488', '#D97706', '#7C3AED', '#DB2777',
  '#65A30D', '#0891B2', '#B45309', '#4F46E5', '#BE123C',
] as const;

export function seriesColor(index: number, isFocus = false): string {
  if (isFocus) return ACCENT;
  return SERIES_PALETTE[index % SERIES_PALETTE.length];
}

/**
 * Deterministic color for a company: an explicit brand color if the record has
 * one, otherwise a stable slot in the palette so a company keeps the same color
 * across every screen in the app.
 */
export function companyColor(
  company: { id: string; color?: string | null },
  index: number,
  focusId?: string | null,
): string {
  if (focusId && company.id === focusId) return ACCENT;
  if (company.color) return company.color;
  return SERIES_PALETTE[index % SERIES_PALETTE.length];
}

export function platformColor(platform: Platform): string {
  return PLATFORM_COLORS[platform];
}

/** Shared axis props so every chart in the product has identical typography. */
export const axisProps = {
  stroke: CHART_AXIS,
  tick: { fill: CHART_LABEL, fontSize: 11 },
  tickLine: false,
  axisLine: false,
} as const;

export const gridProps = {
  stroke: CHART_GRID,
  strokeDasharray: '3 3',
  vertical: false,
} as const;

/** Standard heights, so cards line up in a grid without bespoke numbers. */
export const CHART_HEIGHT = {
  spark: 40,
  short: 180,
  medium: 260,
  tall: 340,
} as const;
