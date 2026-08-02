import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { changePct, metricTestHelpers } from './queries';

const {
  audienceMetricAvailable,
  audienceStockTotal,
  aggregateTagPerformanceRows,
  channelProvidesAudience,
  followerRateContribution,
  followerRateAvailable,
  mergeMinimumObservedDays,
  metricAvailabilityForCoverage,
  platformHasCompleteFlow,
  safeDiv,
  sourceMedianEngagement,
} = metricTestHelpers;

describe('changePct', () => {
  it('returns null when the baseline is zero', () => {
    assert.equal(changePct(0, 0), null);
    assert.equal(changePct(1, 0), null);
    assert.equal(changePct(10_000, -0), null);
  });

  it('returns null when the baseline is missing or the result is not finite', () => {
    assert.equal(changePct(100, null), null);
    assert.equal(changePct(100, undefined), null);
    assert.equal(changePct(Number.POSITIVE_INFINITY, 100), null);
    assert.equal(changePct(100, Number.POSITIVE_INFINITY), null);
  });

  it('returns a fractional increase or decrease for a nonzero baseline', () => {
    assert.equal(changePct(125, 100), 0.25);
    assert.equal(changePct(75, 100), -0.25);
    assert.equal(changePct(0, 100), -1);
  });
});

describe('safeDiv', () => {
  it('divides finite values, including negative values', () => {
    assert.equal(safeDiv(9, 3), 3);
    assert.equal(safeDiv(1, 4), 0.25);
    assert.equal(safeDiv(1, -2), -0.5);
  });

  it('returns zero for zero or non-finite denominators', () => {
    for (const denominator of [
      0,
      -0,
      Number.NaN,
      Number.POSITIVE_INFINITY,
      Number.NEGATIVE_INFINITY,
    ]) {
      assert.equal(safeDiv(10, denominator), 0);
    }
  });

  it('returns zero rather than NaN or Infinity for a non-finite numerator', () => {
    assert.equal(safeDiv(Number.NaN, 2), 0);
    assert.equal(safeDiv(Number.POSITIVE_INFINITY, 2), 0);
    assert.equal(safeDiv(Number.NEGATIVE_INFINITY, 2), 0);
  });
});

describe('tag lift', () => {
  it("weights each tagged post against its own company's untagged baseline", () => {
    const rows = aggregateTagPerformanceRows([
      {
        tag_id: 'breaking',
        tag_name: 'Breaking',
        tag_color: '#ef4444',
        company_id: 'large-brand',
        post_count: 2,
        engagement_total: 200,
        erf: 0.04,
        rated_posts: 2,
        total_posts: 10,
        base_erf: 0.02,
      },
      {
        tag_id: 'breaking',
        tag_name: 'Breaking',
        tag_color: '#ef4444',
        company_id: 'small-brand',
        post_count: 1,
        engagement_total: 50,
        erf: 0.01,
        rated_posts: 1,
        total_posts: 10,
        base_erf: 0.01,
      },
    ]);

    assert.equal(rows.length, 1);
    assert.equal(rows[0]?.postCount, 3);
    assert.equal(rows[0]?.engagementTotal, 250);
    assert.ok(Math.abs((rows[0]?.engagementRateByFollower ?? 0) - 0.03) < 1e-12);
    assert.ok(Math.abs((rows[0]?.lift ?? 0) - 5 / 3) < 1e-12);
  });

  it('leaves lift blank when no same-company untagged baseline exists', () => {
    const rows = aggregateTagPerformanceRows([
      {
        tag_id: 'exclusive',
        tag_name: 'Exclusive',
        tag_color: null,
        company_id: 'only-brand',
        post_count: 2,
        engagement_total: 100,
        erf: 0.05,
        rated_posts: 2,
        total_posts: 2,
        base_erf: null,
      },
    ]);

    assert.equal(rows[0]?.lift, null);
  });
});

describe('audienceStockTotal', () => {
  const latestReadings = [
    { channelId: 'instagram', day: '2026-07-29', followers: 130 },
    { channelId: 'tiktok', day: '2026-07-28', followers: 260 },
  ] as const;

  it('sums the latest reading for each channel', () => {
    const snapshots = [
      { channelId: 'instagram', day: '2026-07-27', followers: 100 },
      { channelId: 'tiktok', day: '2026-07-28', followers: 260 },
      { channelId: 'instagram', day: '2026-07-29', followers: 130 },
      { channelId: 'tiktok', day: '2026-07-26', followers: 200 },
    ];

    assert.equal(audienceStockTotal(snapshots), 390);
  });

  it('does not inflate audience when older snapshots widen the window', () => {
    const historicalReadings = [
      { channelId: 'instagram', day: '2026-07-01', followers: 90 },
      { channelId: 'instagram', day: '2026-07-15', followers: 110 },
      { channelId: 'tiktok', day: '2026-07-01', followers: 180 },
      { channelId: 'tiktok', day: '2026-07-15', followers: 220 },
    ] as const;

    assert.equal(audienceStockTotal(latestReadings), 390);
    assert.equal(audienceStockTotal([...historicalReadings, ...latestReadings]), 390);
  });

  it('returns zero when no audience snapshots exist', () => {
    assert.equal(audienceStockTotal([]), 0);
  });
});

describe('audience metric availability', () => {
  it('requires two audience observations for net change and growth', () => {
    assert.equal(audienceMetricAvailable('audience', 1, 100), true);
    assert.equal(audienceMetricAvailable('audienceNetChange', 1, 100), false);
    assert.equal(audienceMetricAvailable('audienceGrowthRate', 1, 100), false);
    assert.equal(audienceMetricAvailable('audienceNetChange', 2, 100), true);
    assert.equal(audienceMetricAvailable('audienceGrowthRate', 2, 100), true);
  });

  it('keeps growth unavailable when the measured baseline is zero', () => {
    assert.equal(audienceMetricAvailable('audienceGrowthRate', 2, 0), false);
  });

  it('uses the least-covered included platform and blanks partial change', () => {
    const afterInstagram = mergeMinimumObservedDays(0, 0, 2);
    const completeCoverage = mergeMinimumObservedDays(afterInstagram, 1, 1);

    assert.equal(completeCoverage, 1);
    assert.equal(
      metricAvailabilityForCoverage('audienceNetChange', 2, completeCoverage, 2, 100),
      false,
    );
    assert.equal(
      metricAvailabilityForCoverage('audience', 2, completeCoverage, 2, 100),
      true,
    );
  });

  it('does not treat an untracked company as a measured zero', () => {
    assert.equal(metricAvailabilityForCoverage('posts', 0, 0, 0, 0), false);
    assert.equal(metricAvailabilityForCoverage('posts', 1, 0, 0, 0), true);
  });

  it('requires every configured profile before treating a total as measured', () => {
    assert.equal(platformHasCompleteFlow(0, 0), false);
    assert.equal(platformHasCompleteFlow(1, 0), false);
    assert.equal(platformHasCompleteFlow(1, 1), true);
    assert.equal(platformHasCompleteFlow(2, 1), false);
    assert.equal(platformHasCompleteFlow(2, 2), true);
  });
});

describe('Reddit account metric boundaries', () => {
  it('keeps audience-less user channels out of audience coverage', () => {
    assert.equal(channelProvidesAudience('reddit', 'u/example'), false);
    assert.equal(channelProvidesAudience('reddit', 'U/Example'), false);
    assert.equal(channelProvidesAudience('reddit', 'r/boston'), true);
    assert.equal(channelProvidesAudience('reddit', 'boston'), true);
    assert.equal(channelProvidesAudience('instagram', 'u/example'), true);
  });

  it('leaves follower rate unavailable when no post captured a denominator', () => {
    const contribution = followerRateContribution(0, 0, 789_224);
    assert.deepEqual(contribution, {
      numerator: 0,
      posts: 0,
    });
    assert.equal(followerRateAvailable(contribution.posts), false);
  });

  it('uses only rated post engagement and count when a source mixes coverage', () => {
    const contribution = followerRateContribution(300, 2, 1_000);
    assert.deepEqual(contribution, {
      numerator: 0.3,
      posts: 2,
    });
    assert.equal(followerRateAvailable(contribution.posts), true);
  });
});

describe('source-scoped outlier medians', () => {
  it('does not mix a Reddit user account with a subreddit at the same company', () => {
    const medians = sourceMedianEngagement([
      { sourceId: 'reddit:r/boston', engagementTotal: 100 },
      { sourceId: 'reddit:r/boston', engagementTotal: 300 },
      { sourceId: 'reddit:u/example', engagementTotal: 10 },
      { sourceId: 'reddit:u/example', engagementTotal: 20 },
      { sourceId: 'reddit:u/example', engagementTotal: 30 },
    ]);

    assert.equal(medians.get('reddit:r/boston'), 200);
    assert.equal(medians.get('reddit:u/example'), 20);
  });
});
