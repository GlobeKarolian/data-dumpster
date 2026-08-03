/**
 * The regression this file exists for: Content Analysis and the SQL engine
 * disagreed on this metric by 5.2x, on the one figure the product calls fair
 * to compare across companies.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { followerRate } from './follower-rate';

describe('followerRate', () => {
  it('is the mean of per-post rates, not pooled engagement over pooled reach', () => {
    // 10 posts on a 1,000,000-follower account earning 1,000 each, and
    // 90 posts on a 10,000-follower account earning 100 each.
    const rows = [
      ...Array.from({ length: 10 }, () => ({ engagementTotal: 1000, followersAtPost: 1_000_000 })),
      ...Array.from({ length: 90 }, () => ({ engagementTotal: 100, followersAtPost: 10_000 })),
    ];
    const { rate } = followerRate(rows);

    const pooled = (10 * 1000 + 90 * 100) / (10 * 1_000_000 + 90 * 10_000);
    const expected = (10 * (1000 / 1_000_000) + 90 * (100 / 10_000)) / 100;

    assert.ok(rate !== null);
    assert.ok(Math.abs(rate - expected) < 1e-12, `expected ${expected}, got ${rate}`);
    assert.ok(Math.abs(rate - pooled) > 1e-6,
      'the pooled ratio is a different statistic and must not be what we return');
    assert.ok(rate > pooled * 4, 'pooling let the large account swamp the small one');
  });

  it('returns null when nothing carried a denominator, never zero', () => {
    const { rate, ratedPosts } = followerRate([
      { engagementTotal: 500, followersAtPost: null },
      { engagementTotal: 200, followersAtPost: 0 },
    ]);
    assert.equal(rate, null, 'no follower reading means no rate, not a rate of zero');
    assert.equal(ratedPosts, 0);
  });

  it('excludes unrated posts from the average rather than counting them as zero', () => {
    const { rate, ratedPosts } = followerRate([
      { engagementTotal: 100, followersAtPost: 1000 },   // 0.1
      { engagementTotal: 900, followersAtPost: null },   // no denominator
    ]);
    assert.equal(ratedPosts, 1);
    assert.equal(rate, 0.1, 'the unrated post must not drag the mean toward zero');
  });

  it('handles an empty set', () => {
    assert.deepEqual(followerRate([]), { rate: null, ratedPosts: 0 });
  });
});
