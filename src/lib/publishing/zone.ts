/**
 * Newsroom wall-clock time. Posting rules are written in Boston time ("weekday
 * evenings 6 to 10pm"), and the server runs in UTC, so every rule is evaluated
 * through these helpers. No timezone library: Intl does the offset math,
 * including the DST changeover.
 */
export const NEWSROOM_TZ = 'America/New_York';

export interface ZonedParts {
  year: number;
  month: number; // 1-12
  day: number;
  /** 0 = Sunday, matching Date#getDay. */
  weekday: number;
  /** Minutes since local midnight. */
  minute: number;
}

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export function zonedParts(at: Date, tz = NEWSROOM_TZ): ZonedParts {
  const f = new Intl.DateTimeFormat('en-US', {
    timeZone: tz, hourCycle: 'h23',
    year: 'numeric', month: 'numeric', day: 'numeric', weekday: 'short', hour: 'numeric', minute: 'numeric',
  });
  const p = Object.fromEntries(f.formatToParts(at).map((x) => [x.type, x.value]));
  return {
    year: Number(p.year),
    month: Number(p.month),
    day: Number(p.day),
    weekday: WEEKDAYS.indexOf(p.weekday),
    minute: Number(p.hour) * 60 + Number(p.minute),
  };
}

/** Offset of the zone from UTC at an instant, in minutes (New York: -240 or -300). */
function offsetMinutes(at: Date, tz: string): number {
  const p = zonedParts(at, tz);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, Math.floor(p.minute / 60), p.minute % 60);
  return Math.round((asUtc - Math.floor(at.getTime() / 60000) * 60000) / 60000);
}

/** The UTC instant for a wall-clock minute on a local calendar day. */
export function zonedToUtc(year: number, month: number, day: number, minute: number, tz = NEWSROOM_TZ): Date {
  const guess = Date.UTC(year, month - 1, day, Math.floor(minute / 60), minute % 60);
  // Two passes settle the offset across a DST boundary.
  let t = guess - offsetMinutes(new Date(guess), tz) * 60000;
  t = guess - offsetMinutes(new Date(t), tz) * 60000;
  return new Date(t);
}

/** Local calendar day key, e.g. 2026-10-06, for grouping a queue by day. */
export function localDayKey(at: Date, tz = NEWSROOM_TZ): string {
  const p = zonedParts(at, tz);
  return `${p.year}-${String(p.month).padStart(2, '0')}-${String(p.day).padStart(2, '0')}`;
}
