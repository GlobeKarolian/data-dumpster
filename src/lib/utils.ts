import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]) { return twMerge(clsx(inputs)); }

/** 1234567 -> "1.23M". Used everywhere a raw count would be unreadable. */
export function compactNumber(n: number | null | undefined, digits = 1): string {
  if (n === null || n === undefined || Number.isNaN(n)) return '—';
  const abs = Math.abs(n);
  if (abs < 1000) return String(Math.round(n));
  const units: [number, string][] = [[1e9, 'B'], [1e6, 'M'], [1e3, 'k']];
  for (const [factor, suffix] of units) {
    if (abs >= factor) {
      const v = n / factor;
      return `${v.toFixed(Math.abs(v) < 10 ? digits : 0)}${suffix}`;
    }
  }
  return String(n);
}

/**
 * Percent change formatting with an opinion: past +999% the exact figure is
 * noise (it almost always means the baseline was near zero), so we say so
 * instead of printing "265,895.2%" and pretending that is information.
 */
export function formatChange(pct: number | null | undefined): { label: string; tone: 'up' | 'down' | 'flat' | 'na' } {
  if (pct === null || pct === undefined || !Number.isFinite(pct)) return { label: 'n/a', tone: 'na' };
  if (Math.abs(pct) < 0.001) return { label: '0%', tone: 'flat' };
  const tone = pct > 0 ? 'up' : 'down';
  if (Math.abs(pct) > 10) return { label: `${pct > 0 ? '+' : '-'}>1000%`, tone };
  const v = pct * 100;
  return { label: `${v > 0 ? '+' : ''}${v.toFixed(Math.abs(v) < 10 ? 1 : 0)}%`, tone };
}

export function percent(n: number | null | undefined, digits = 2): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return '—';
  return `${(n * 100).toFixed(digits)}%`;
}

export function slugify(input: string): string {
  return input.toLowerCase().trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64);
}

export function safeDomain(url: string): string | null {
  try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return null; }
}
