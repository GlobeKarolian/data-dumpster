import type { ContentAnalysis, DimensionRow, RateByBucket } from '@/lib/metrics/content-analysis';

/**
 * One sentence of interpretation per card.
 *
 * The incumbent puts a line like "Your most active channel is Twitter. The
 * channel that generates the highest engagement in your landscape is TikTok"
 * above every table, and it is the single most useful thing on the screen: it
 * does the reading for you. Linda's standing instruction on the weekly report
 * says the same thing in different words, so this is not decoration.
 *
 * Deliberately deterministic rather than model-generated. These fire on every
 * card on every load, they must never be wrong, and the shape is simple enough
 * that a template beats inference. The model earns its keep on briefs, where
 * the reasoning is genuinely open-ended.
 */
const pct = (n: number, digits = 2) => (n * 100).toFixed(digits) + '%';
const hour = (h: number | null) =>
  (h === null ? 'unclear' : h === 0 ? '12am' : h < 12 ? h + 'am' : h === 12 ? '12pm' : (h - 12) + 'pm');
const subject = (focusName?: string | null) => focusName?.trim() || 'The selected company';

/** The row the focus company most under-uses relative to what it earns. */
function biggestMiss(rows: DimensionRow[]): DimensionRow | null {
  const ranked = rows
    .filter((r) => r.posts >= 10)
    .sort((a, b) => b.engagementRateByFollower - a.engagementRateByFollower);
  const best = ranked[0];
  if (!best) return null;
  const share = best.posts > 0 ? best.focusPosts / best.posts : 0;
  return share < 0.25 ? best : null;
}

export function topicsInsight(
  a: ContentAnalysis,
  focusName?: string | null,
  publications = 'posts',
): string {
  const rows = a.topics;
  if (rows.length === 0) return 'Not enough ' + publications + ' in this window to identify topics.';
  const best = [...rows].sort((x, y) => y.engagementRateByFollower - x.engagementRateByFollower)[0];
  const used = rows.filter((r) => r.focusUsed).length;
  return 'Of the ' + rows.length + ' topics the market covered most, "' + best.key
    + '" earned the highest engagement rate at ' + pct(best.engagementRateByFollower)
    + '. ' + subject(focusName) + ' covered ' + used + ' of ' + rows.length
    + (best.focusUsed ? ', including that one.' : ', not including that one.');
}

export function hashtagsInsight(a: ContentAnalysis, focusName?: string | null): string {
  const rows = a.hashtags;
  if (rows.length === 0) return 'No hashtags were used often enough in this window to compare.';
  const best = [...rows].sort((x, y) => y.engagementRateByFollower - x.engagementRateByFollower)[0];
  const unused = rows.filter((r) => !r.focusUsed);
  const tail = unused.length === 0
    ? ' ' + subject(focusName) + ' used all of them.'
    : ' ' + subject(focusName) + ' used none of ' + unused.slice(0, 3).map((r) => r.key).join(', ') + '.';
  return best.key + ' earned the highest engagement rate at ' + pct(best.engagementRateByFollower)
    + '.' + (unused.length === 0 ? tail : tail);
}

export function typesInsight(
  a: ContentAnalysis,
  focusName?: string | null,
  publications = 'posts',
): string {
  const rows = a.postTypes;
  if (rows.length === 0) return 'No ' + publications + ' in this window.';
  const yours = [...rows].sort((x, y) => y.focusPosts - x.focusPosts)[0];
  const best = [...rows].filter((r) => r.posts >= 10)
    .sort((x, y) => y.engagementRateByFollower - x.engagementRateByFollower)[0];
  const label = subject(focusName);
  if (!best) return label + '\'s most common format is ' + yours.key + '.';
  const miss = biggestMiss(rows);
  return label + '\'s most common format is ' + yours.key + '. The format earning the most in this market is '
    + best.key + ' at ' + pct(best.engagementRateByFollower) + '.'
    + (miss ? ' ' + label + ' published ' + miss.focusPosts + ' of the market\'s '
      + miss.posts + ' ' + miss.key + ' ' + publications + '.' : '');
}

export function channelsInsight(
  a: ContentAnalysis,
  focusName?: string | null,
  publications = 'posts',
): string {
  const rows = a.channels;
  if (rows.length === 0) return 'No ' + publications + ' in this window.';
  const yours = [...rows].sort((x, y) => y.focusPosts - x.focusPosts)[0];
  const best = [...rows].filter((r) => r.posts >= 10)
    .sort((x, y) => y.engagementRateByFollower - x.engagementRateByFollower)[0];
  const label = subject(focusName);
  if (!best || best.key === yours.key) {
    return label + '\'s most active channel is ' + yours.key + ', which is also the highest earning here.';
  }
  return label + '\'s most active channel is ' + yours.key + ' at ' + pct(yours.engagementRateByFollower)
    + '. The highest earning channel in this market is ' + best.key + ' at '
    + pct(best.engagementRateByFollower) + '.';
}

export function timesInsight(
  byHour: RateByBucket[],
  topHour: number | null,
  focusName?: string | null,
): string {
  const active = [...byHour].sort((a, b) => b.focusPosts - a.focusPosts)[0];
  const ratePeak = [...byHour].sort((a, b) => b.focusRate - a.focusRate)[0];
  if (!active || active.focusPosts === 0) return 'Not enough publications to read a pattern.';
  const label = subject(focusName);
  return label + ' publishes most at ' + hour(topHour) + '. ' + label + '\'s engagement rate peaks at '
    + hour(ratePeak?.focusRate ? ratePeak.bucket : null) + '.';
}

export { pct, hour };
