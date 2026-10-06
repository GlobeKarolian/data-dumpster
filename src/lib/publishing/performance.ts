/**
 * Hour-of-week weights from an account's own history.
 *
 * Engagement rate (engagement / followers at post) is the comparable measure:
 * raw engagement would just reward the hours we happened to post big stories.
 * Posts without a follower count are excluded, never treated as zero. Each
 * weight is the median rate for that weekday-hour divided by the account's
 * overall median, shrunk toward the hour-of-day median and then toward 1 when
 * samples are thin, so one viral post at 3am cannot move the schedule.
 */
export interface RateSample {
  weekday: number;
  hour: number;
  rate: number;
}

const MIN_TOTAL = 30;
const SHRINK = 8;
/** A cell can at most triple or a third of typical: the schedule nudges, it does not lurch. */
const CAP = 3;
const clamp = (x: number) => Math.min(CAP, Math.max(1 / CAP, x));

function median(xs: number[]): number | null {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

export function buildHourWeights(samples: RateSample[]): number[][] | null {
  const valid = samples.filter((s) => Number.isFinite(s.rate) && s.rate >= 0);
  if (valid.length < MIN_TOTAL) return null;
  const overall = median(valid.map((s) => s.rate));
  if (!overall || overall <= 0) return null;

  const byHour: number[][] = Array.from({ length: 24 }, () => []);
  const byCell: number[][][] = Array.from({ length: 7 }, () => Array.from({ length: 24 }, () => []));
  for (const s of valid) {
    byHour[s.hour].push(s.rate);
    byCell[s.weekday][s.hour].push(s.rate);
  }
  const hourWeight = byHour.map((xs) => {
    const m = median(xs);
    if (m == null) return 1;
    const raw = clamp(m / overall);
    return (raw * xs.length + 1 * SHRINK) / (xs.length + SHRINK);
  });
  return byCell.map((row) =>
    row.map((xs, h) => {
      const m = median(xs);
      if (m == null) return round(hourWeight[h]);
      const raw = clamp(m / overall);
      return round((raw * xs.length + hourWeight[h] * SHRINK) / (xs.length + SHRINK));
    }),
  );
}

function round(x: number): number {
  return Math.round(x * 100) / 100;
}
