/**
 * The bridge from an Adobe Freeform file to the rows a report section renders.
 *
 * Kept separate from the parser so the parser stays a pure reader of the format
 * and this file owns the editorial decisions: which rows rank, how direct
 * traffic is treated, and what the reader is told about everything left out.
 */
import { parseAdobeFreeform } from './adobe-freeform';
import { rollUpReferrals, CATEGORY_LABELS, type ReferralGroup } from './referral-platforms';
import { rowsToTsv } from './tsv';
import type { ManualTable } from './types';

export type ImportSummary = {
  reportSuite: string | null;
  dateRange: string | null;
  /** Domain rows read from the file, before rollup. */
  domainsRead: number;
  /** Platforms remaining after rollup that drove at least one subscription. */
  platformsRanked: number;
  newSubscriptions: number;
  visits: number;
  /** Platforms whose conversion rate was withheld as too small to be meaningful. */
  ratesWithheld: number;
  minConversionsForRate: number;
  /** Direct traffic, held out of the ranking because it is not a referrer. */
  direct: { visits: number; subscriptions: number; conversionRate: number | null } | null;
  zeroSubDomains: number;
  zeroSubVisits: number;
  /**
   * Subscriptions in Adobe's total row that no itemised domain accounts for.
   * Adobe truncates the long tail, so this is expected to be small and non-zero.
   * Reported rather than absorbed, because a reader who adds the column up
   * deserves to find the difference explained instead of hidden.
   */
  unitemisedSubscriptions: number | null;
  problems: string[];
};

export type ImportResult =
  | { ok: true; table: ManualTable; summary: ImportSummary; groups: ReferralGroup[] }
  | { ok: false; problems: string[] };

function pct(v: number | null): string {
  return v === null ? '—' : (v * 100).toFixed(3) + '%';
}

/**
 * Grouped, and with an explicit locale.
 *
 * These strings go straight into the PowerPoint and HTML exports, which do no
 * formatting of their own. Pinning en-US keeps a deck built on a machine set to
 * a European locale from rendering 723.823 next to 0.111%, where the separator
 * would read as a decimal point.
 */
function int(v: number): string {
  return v.toLocaleString('en-US');
}

/**
 * Rows are the rolled-up platforms; `raw` is their tab-separated form.
 *
 * Keeping the 16KB source file in `raw` was the first instinct, since it would
 * let a changed rollup rule be reapplied without asking anyone to find the
 * export again. It was wrong twice over: `raw` is bound to a textarea the user
 * can edit, so a single keystroke in the paste view would reparse an Adobe
 * multi-table file as flat CSV and destroy the rows, and every report would
 * carry the whole file in its jsonb column forever. The export lives on disk
 * and can be dropped again, which is cheaper than either failure.
 *
 * (This note describes importAdobeFreeform below; the two constants sit between
 * because they are the thresholds it applies.)
 */

/**
 * How many platforms get their own row before the rest are collapsed.
 *
 * Everything below the cut is summed into a single "other referrers" line, so
 * no traffic and no subscription disappears from the totals.
 */
const RANK_LIMIT = 12;

/**
 * Fewest conversions a rate may be built on before it is reported at all.
 *
 * At the site's 0.13% conversion rate a domain needs roughly 770 visits to
 * expect even one subscription, so a single conversion on four visits produces
 * a "25% conversion rate" that is entirely sampling noise. Printed in a table
 * next to Google's 0.111% it invites exactly the wrong conclusion, and the
 * number is real enough to survive being repeated in a meeting. Below this
 * floor the count is still shown and the rate is withheld.
 */
const MIN_CONVERSIONS_FOR_RATE = 5;

/**
 * What the section ranks on.
 *
 * The Globe ranks by subscriptions driven, because that is what its referral
 * section is for. Boston.com and STAT have no meaningful subscription metric
 * (Boston.com recorded four in the whole week, three of them arriving from a
 * Globe link), so ranking on it would be sorting noise. They rank by traffic.
 */
export type ImportRank = 'subscriptions' | 'visits';

export function importAdobeFreeform(
  text: string,
  rank: ImportRank = 'subscriptions',
): ImportResult {
  const bySubs = rank === 'subscriptions';
  const parsed = parseAdobeFreeform(text, { requireSubscriptions: bySubs });
  if (!parsed.ok) return { ok: false, problems: parsed.problems };

  const roll = rollUpReferrals(parsed.rows);
  const earning = bySubs
    ? roll.platforms.filter((g) => g.newSubscriptions > 0)
    : roll.platforms.filter((g) => g.visits > 0).sort((a, b) => b.visits - a.visits);
  const ranked = earning.slice(0, RANK_LIMIT);
  const tail = earning.slice(RANK_LIMIT);

  const rate = (g: { newSubscriptions: number; conversionRate: number | null }) =>
    (g.newSubscriptions >= MIN_CONVERSIONS_FOR_RATE ? pct(g.conversionRate) : '—');

  /*
   * Share is of the property's whole referred traffic, not of the visible rows.
   *
   * Dividing by the ranked subset would make the column sum to 100% and mean
   * nothing, and would inflate Google precisely because the tail was cut. The
   * denominator is every referring domain in the file, direct included, so
   * 19.3% stays 19.3% however many rows are shown.
   */
  const shareBase = (roll.direct?.visits ?? 0)
    + roll.platforms.reduce((s, g) => s + g.visits, 0)
    + roll.nonPlatform.reduce((s, g) => s + g.visits, 0);
  const share = (v: number) => (shareBase > 0 ? (v / shareBase * 100).toFixed(1) + '%' : '—');

  const rows = bySubs
    ? ranked.map((g) => [g.label, int(g.visits), int(g.newSubscriptions), rate(g)])
    : ranked.map((g) => [g.label, int(g.visits), share(g.visits)]);

  if (tail.length > 0) {
    const visits = tail.reduce((s, g) => s + g.visits, 0);
    const subs = tail.reduce((s, g) => s + g.newSubscriptions, 0);
    rows.push(bySubs
      ? [
        `All other referrers (${tail.length})`,
        int(visits), int(subs),
        subs >= MIN_CONVERSIONS_FOR_RATE && visits > 0 ? pct(subs / visits) : '—',
      ]
      : [`All other referrers (${tail.length})`, int(visits), share(visits)]);
  }

  // Paid placement and owned-to-owned traffic on their own labelled lines, so
  // the totals still tie without either competing for a platform rank.
  for (const g of roll.nonPlatform) {
    const label = `${g.label} (${CATEGORY_LABELS[g.category].toLowerCase()})`;
    rows.push(bySubs
      ? [label, int(g.visits), int(g.newSubscriptions), rate(g)]
      : [label, int(g.visits), share(g.visits)]);
  }

  const itemised = parsed.rows.reduce((s, r) => s + (r.newSubscriptions ?? 0), 0);
  const totalSubs = parsed.total?.newSubscriptions ?? null;

  const summary: ImportSummary = {
    reportSuite: parsed.reportSuite,
    dateRange: parsed.dateRange,
    domainsRead: parsed.rows.length,
    platformsRanked: ranked.length,
    // Totals span every earning platform, including the collapsed tail, so the
    // footer never disagrees with the last row of the table.
    newSubscriptions: earning.reduce((s, g) => s + g.newSubscriptions, 0),
    visits: earning.reduce((s, g) => s + g.visits, 0),
    ratesWithheld: earning.filter((g) => g.newSubscriptions < MIN_CONVERSIONS_FOR_RATE).length,
    minConversionsForRate: MIN_CONVERSIONS_FOR_RATE,
    direct: roll.direct
      ? {
        visits: roll.direct.visits,
        subscriptions: roll.direct.newSubscriptions,
        conversionRate: roll.direct.conversionRate,
      }
      : null,
    zeroSubDomains: roll.zeroSubDomains,
    zeroSubVisits: roll.zeroSubVisits,
    unitemisedSubscriptions: totalSubs === null ? null : totalSubs - itemised,
    problems: parsed.problems,
  };

  return {
    ok: true,
    groups: ranked,
    summary,
    table: {
      raw: rowsToTsv(rows),
      rows,
      updatedAt: new Date().toISOString(),
    },
  };
}

/** Human sentence for the footer under an imported section. */
export function describeImport(s: ImportSummary, fileName?: string): string {
  const parts: string[] = [];
  if (fileName) parts.push(fileName);
  if (s.dateRange) parts.push(s.dateRange);
  if (s.reportSuite) parts.push(s.reportSuite);
  parts.push(`${s.domainsRead} domains read, ${s.platformsRanked} platforms ranked`);
  return parts.join(' · ');
}
