import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { MetricRow } from '@/lib/types';
import {
  NEWSROOM_FRESH_PROFILE_HOURS,
  newsroomFreshness,
  newsroomLeaderboardRows,
} from './newsroom-display';

function row(rank: number, available = true): MetricRow {
  return {
    company: { id: `company-${rank}`, name: `Company ${rank}`, slug: `company-${rank}` },
    value: 1_000 - rank,
    available,
    rank,
  };
}

describe('newsroom display helpers', () => {
  it('keeps an out-of-frame focus company on the television leaderboard', () => {
    const rows = Array.from({ length: 12 }, (_, index) => row(index + 1));
    assert.deepEqual(
      newsroomLeaderboardRows(rows, 'company-11', 8).map((item) => item.rank),
      [1, 2, 3, 4, 5, 6, 7, 11],
    );
  });

  it('never promotes unavailable companies into a measured leaderboard', () => {
    const rows = [row(1, false), row(2), row(3)];
    assert.deepEqual(
      newsroomLeaderboardRows(rows, 'company-1', 8).map((item) => item.rank),
      [2, 3],
    );
  });

  it('uses the twice-daily collection cadence for freshness warnings', () => {
    const now = Date.parse('2026-08-05T18:00:00.000Z');
    const fresh = new Date(now - (NEWSROOM_FRESH_PROFILE_HOURS - 1) * 3_600_000).toISOString();
    const aging = new Date(now - 18 * 3_600_000).toISOString();
    const stale = new Date(now - 30 * 3_600_000).toISOString();

    assert.equal(newsroomFreshness(fresh, now).tone, 'fresh');
    assert.equal(newsroomFreshness(aging, now).tone, 'aging');
    assert.equal(newsroomFreshness(stale, now).tone, 'stale');
    assert.equal(newsroomFreshness(null, now).tone, 'unknown');
  });
});
