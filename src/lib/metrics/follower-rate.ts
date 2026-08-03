/**
 * The one definition of engagement rate by follower.
 *
 * This metric is the only one in the product that is genuinely fair to compare
 * across companies of different sizes, which makes it the one most worth
 * getting right, and it had two implementations that disagreed.
 *
 * The correct definition is the MEAN OF PER-POST RATES: each post's engagement
 * divided by the follower count of the account that published it, averaged over
 * posts. The SQL engine expresses this per platform as Σ(E_p / F_p) ÷ Σn_p,
 * which is identical because every post on a platform shares that platform's
 * follower base.
 *
 * The Content Analysis screen instead computed ΣE ÷ Σf — a pooled,
 * follower-weighted ratio. That is a different statistic, not a rounding
 * difference. Worked example, one company on two platforms:
 *
 *   Platform A: 1,000,000 followers, 10 posts,  10,000 engagement
 *   Platform B:    10,000 followers, 90 posts,   9,000 engagement
 *
 *   mean of per-post rates: (0.01 + 0.9) / 100      = 0.910%
 *   pooled ratio:           19,000 / 10,900,000     = 0.174%
 *
 * A 5.2x gap on the same screen's headline comparison. Pooling lets one
 * enormous account dominate the denominator, so a brand that performs well on
 * a small, engaged platform reads as though it performs badly.
 *
 * Null rather than zero when nothing was measurable. A post with no follower
 * reading has no rate, and averaging it in as 0.000% drags a company down for
 * the offence of missing data.
 */

export interface FollowerRateInput {
  engagementTotal: number;
  /** Followers at the time of posting. Null when the reading was never taken. */
  followersAtPost: number | null;
}

/**
 * Mean of per-post engagement rates. Null when no post carried a denominator.
 *
 * Posts without a follower reading are excluded from both the sum and the
 * count, never counted as zero. `ratedPosts` is returned so callers can say how
 * much of the set actually supported the figure.
 */
export function followerRate(rows: readonly FollowerRateInput[]): {
  rate: number | null;
  ratedPosts: number;
} {
  let sum = 0;
  let n = 0;
  for (const r of rows) {
    const followers = r.followersAtPost;
    if (followers !== null && followers > 0) {
      sum += r.engagementTotal / followers;
      n += 1;
    }
  }
  return { rate: n > 0 ? sum / n : null, ratedPosts: n };
}

/** Accumulator form, for callers bucketing rows in a single pass. */
export interface FollowerRateAcc { sum: number; rated: number }

export function newFollowerRateAcc(): FollowerRateAcc {
  return { sum: 0, rated: 0 };
}

export function addToFollowerRate(acc: FollowerRateAcc, row: FollowerRateInput): void {
  const followers = row.followersAtPost;
  if (followers !== null && followers > 0) {
    acc.sum += row.engagementTotal / followers;
    acc.rated += 1;
  }
}

export function finishFollowerRate(acc: FollowerRateAcc): number | null {
  return acc.rated > 0 ? acc.sum / acc.rated : null;
}
