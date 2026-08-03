import type { Granularity, DateRange } from './types';

/**
 * The zone every window boundary and every bucket is expressed in.
 *
 * This is not a preference, it is a correctness requirement. All SQL bucketing
 * runs `AT TIME ZONE 'America/New_York'`, while the helpers in this file use
 * date-fns, which works in the SERVER's zone. On Vercel that is UTC, and the
 * two disagreed by four hours.
 *
 * The symptom was quiet and specific: a post published at 00:30 Eastern fell
 * inside the fetched range but bucketed to the previous Eastern day, which was
 * not in the generated axis, so it was dropped from every chart while still
 * counting toward the headline totals and the leaderboard beside them. Chart
 * columns did not sum to the number printed above them. The weekly report
 * window was shifted the same four hours, running Sunday 20:00 to Sunday 19:59.
 *
 * `TZ=America/New_York` is set on the deployment so date-fns and Postgres agree.
 * `assertReportZone` exists so a deploy that loses that variable says so rather
 * than silently shifting every window again.
 */
export const REPORT_TIME_ZONE = 'America/New_York';

/** What the process actually resolved to. Reported by /api/health. */
export function currentTimeZone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone;
}

export function timeZoneMatchesReportZone(): boolean {
  return currentTimeZone() === REPORT_TIME_ZONE;
}

/* ------------------------------------------------ zone-aware primitives */

const PARTS = new Intl.DateTimeFormat('en-US', {
  timeZone: REPORT_TIME_ZONE,
  year: 'numeric', month: '2-digit', day: '2-digit',
  hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
});

function zoneParts(d: Date): {
  year: number; month: number; day: number; hour: number; minute: number; second: number;
} {
  const parts = PARTS.formatToParts(d);
  const get = (t: Intl.DateTimeFormatPartTypes) =>
    Number(parts.find((p) => p.type === t)?.value ?? '0');
  return {
    year: get('year'), month: get('month'), day: get('day'),
    hour: get('hour'), minute: get('minute'), second: get('second'),
  };
}

/**
 * Offset of the report zone from UTC at a given instant, in minutes.
 *
 * Derived from the formatted parts rather than a table, so daylight saving is
 * handled by the platform. A window that straddles the March or November
 * transition gets the right offset on each side.
 */
function zoneOffsetMs(d: Date): number {
  const p = zoneParts(d);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  // Second-truncate the instant so the difference is a clean offset.
  return asUtc - Math.floor(d.getTime() / 1000) * 1000;
}

/** The instant at which a given wall-clock time occurs in the report zone. */
function fromZoneWallClock(
  year: number, month: number, day: number,
  hour = 0, minute = 0, second = 0, ms = 0,
): Date {
  const naive = Date.UTC(year, month - 1, day, hour, minute, second, ms);
  // Two passes: the first offset may be the wrong side of a DST boundary.
  let guess = new Date(naive - zoneOffsetMs(new Date(naive)));
  guess = new Date(naive - zoneOffsetMs(guess));
  return guess;
}

/** Midnight in the report zone, as an instant. */
export function startOfZoneDay(d: Date): Date {
  const p = zoneParts(d);
  return fromZoneWallClock(p.year, p.month, p.day);
}

/** The last representable millisecond of the report-zone day. */
export function endOfZoneDay(d: Date): Date {
  const p = zoneParts(d);
  return fromZoneWallClock(p.year, p.month, p.day, 23, 59, 59, 999);
}

/** Shift by whole days in the report zone, DST-safe. */
export function addZoneDays(d: Date, days: number): Date {
  const p = zoneParts(d);
  return fromZoneWallClock(p.year, p.month, p.day + days, p.hour, p.minute, p.second);
}

/** Last day of the report-zone month containing this instant. */
export function endOfZoneMonth(d: Date): Date {
  const p = zoneParts(d);
  // Day 0 of the following month is the last day of this one, leap years included.
  return endOfZoneDay(fromZoneWallClock(p.year, p.month + 1, 0, 12));
}

/** Calendar days between two instants, counted in the report zone. */
function zoneDayNumber(d: Date): number {
  const p = zoneParts(d);
  return Math.floor(Date.UTC(p.year, p.month - 1, p.day) / 86_400_000);
}

export const PRESETS = [
  { id: '7d', label: 'Last 7 days', days: 7 },
  { id: '28d', label: 'Last 28 days', days: 28 },
  { id: '90d', label: 'Last 90 days', days: 90 },
  { id: '180d', label: 'Last 6 months', days: 180 },
  { id: '365d', label: 'Last 12 months', days: 365 },
] as const;

export function presetRange(days: number, now = new Date()): DateRange {
  return { start: startOfZoneDay(addZoneDays(now, -(days - 1))), end: endOfZoneDay(now) };
}

/** The window immediately before `range`, same length. This is what every delta compares to. */
export function previousRange({ start, end }: DateRange): DateRange {
  const len = daysIn({ start, end });
  return {
    start: startOfZoneDay(addZoneDays(start, -len)),
    end: endOfZoneDay(addZoneDays(end, -len)),
  };
}

/** Pick a sensible bucket size so charts never render 365 unreadable bars. */
export function autoGranularity({ start, end }: DateRange): Granularity {
  const days = daysIn({ start, end });
  if (days <= 31) return 'day';
  if (days <= 180) return 'week';
  return 'month';
}

export function bucketKey(d: Date, g: Granularity): string {
  const p = zoneParts(d);
  if (g === 'day') return toDayString(d);
  if (g === 'month') return pad(p.year, p.month, 1);
  // ISO week starting Monday, computed on the zone's calendar day.
  const dow = new Date(Date.UTC(p.year, p.month - 1, p.day)).getUTCDay();
  const backToMonday = (dow + 6) % 7;
  return toDayString(addZoneDays(startOfZoneDay(d), -backToMonday));
}

function pad(year: number, month: number, day: number): string {
  return String(year).padStart(4, '0') + '-'
    + String(month).padStart(2, '0') + '-'
    + String(day).padStart(2, '0');
}

export function daysIn({ start, end }: DateRange): number {
  return zoneDayNumber(end) - zoneDayNumber(start) + 1;
}

export function dayStrings({ start, end }: DateRange): string[] {
  const out: string[] = [];
  const total = daysIn({ start, end });
  let cursor = startOfZoneDay(start);
  for (let i = 0; i < total; i += 1) {
    out.push(toDayString(cursor));
    cursor = addZoneDays(cursor, 1);
  }
  return out;
}

/** The calendar day this instant falls on IN THE REPORT ZONE. */
export function toDayString(d: Date): string {
  const p = zoneParts(d);
  return pad(p.year, p.month, p.day);
}

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
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  const parsed = startOfZoneDay(fromZoneWallClock(year, month, day, 12));
  // Reject 2026-02-31 and friends, which roll forward rather than failing.
  if (toDayString(parsed) !== pad(year, month, day)) return null;
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
    const start = parsedStart ? startOfZoneDay(parsedStart) : new Date(Number.NaN);
    const end = parsedEnd ? endOfZoneDay(parsedEnd) : new Date(Number.NaN);
    if (!Number.isNaN(+start) && !Number.isNaN(+end) && start <= end) return { start, end };
  }
  const preset = sp.get('range');
  const found = PRESETS.find((p) => p.id === preset);
  return presetRange(found?.days ?? fallbackDays);
}
