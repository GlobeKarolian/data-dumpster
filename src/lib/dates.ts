import {
  differenceInCalendarDays, subDays, startOfDay, endOfDay,
  format, eachDayOfInterval, startOfWeek, startOfMonth,
} from 'date-fns';
import type { Granularity, DateRange } from './types';

export const PRESETS = [
  { id: '7d', label: 'Last 7 days', days: 7 },
  { id: '28d', label: 'Last 28 days', days: 28 },
  { id: '90d', label: 'Last 90 days', days: 90 },
  { id: '180d', label: 'Last 6 months', days: 180 },
  { id: '365d', label: 'Last 12 months', days: 365 },
] as const;

export function presetRange(days: number, now = new Date()): DateRange {
  return { start: startOfDay(subDays(now, days - 1)), end: endOfDay(now) };
}

/** The window immediately before `range`, same length. This is what every delta compares to. */
export function previousRange({ start, end }: DateRange): DateRange {
  const len = differenceInCalendarDays(end, start) + 1;
  return { start: startOfDay(subDays(start, len)), end: endOfDay(subDays(end, len)) };
}

/** Pick a sensible bucket size so charts never render 365 unreadable bars. */
export function autoGranularity({ start, end }: DateRange): Granularity {
  const days = differenceInCalendarDays(end, start) + 1;
  if (days <= 31) return 'day';
  if (days <= 180) return 'week';
  return 'month';
}

export function bucketKey(d: Date, g: Granularity): string {
  if (g === 'day') return format(d, 'yyyy-MM-dd');
  if (g === 'week') return format(startOfWeek(d, { weekStartsOn: 1 }), 'yyyy-MM-dd');
  return format(startOfMonth(d), 'yyyy-MM-dd');
}

export function daysIn({ start, end }: DateRange): number {
  return differenceInCalendarDays(end, start) + 1;
}

export function dayStrings({ start, end }: DateRange): string[] {
  return eachDayOfInterval({ start, end }).map((d) => format(d, 'yyyy-MM-dd'));
}

export function toDayString(d: Date): string { return format(d, 'yyyy-MM-dd'); }

const DATE_ONLY = /^(\d{4})-(\d{2})-(\d{2})$/;

/**
 * Parse an HTML/URL date value as a calendar day in the reader's timezone.
 *
 * `new Date('2026-07-01')` is midnight UTC, which is still June 30 in Boston.
 * Date-only values in this product describe calendar windows, not instants, so
 * they must be constructed from local date parts.
 */
export function parseLocalDay(value: string): Date | null {
  const match = DATE_ONLY.exec(value);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const parsed = new Date(year, month - 1, day);
  if (
    parsed.getFullYear() !== year
    || parsed.getMonth() !== month - 1
    || parsed.getDate() !== day
  ) return null;
  return parsed;
}

/** Parse either a date-only calendar value or a real timestamp. */
export function parseDateValue(value: string | Date): Date {
  if (value instanceof Date) return value;
  return parseLocalDay(value) ?? new Date(value);
}

export function parseRangeParams(sp: URLSearchParams, fallbackDays = 28): DateRange {
  const s = sp.get('start'); const e = sp.get('end');
  if (s && e) {
    const parsedStart = parseLocalDay(s);
    const parsedEnd = parseLocalDay(e);
    const start = parsedStart ? startOfDay(parsedStart) : new Date(Number.NaN);
    const end = parsedEnd ? endOfDay(parsedEnd) : new Date(Number.NaN);
    if (!Number.isNaN(+start) && !Number.isNaN(+end) && start <= end) return { start, end };
  }
  const preset = sp.get('range');
  const found = PRESETS.find((p) => p.id === preset);
  return presetRange(found?.days ?? fallbackDays);
}
