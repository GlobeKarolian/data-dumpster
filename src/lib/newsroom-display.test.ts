import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { MetricRow } from '@/lib/types';
import {
  NEWSROOM_FRESH_PROFILE_HOURS,
  NEWSROOM_PLATFORMS,
  newsroomFreshness,
  newsroomLeaderboardRows,
  newsroomPlatformWinners,
  newsroomTrailing24Hours,
  newsroomTodaySearchParams,
} from './newsroom-display';
import type { PostDto } from './metrics/contract';

function row(rank: number, available = true): MetricRow {
  return {
    company: { id: `company-${rank}`, name: `Company ${rank}`, slug: `company-${rank}` },
    value: 1_000 - rank,
    available,
    rank,
  };
}

describe('newsroom display helpers', () => {
  it('always replaces historical ranges with the current Boston day', () => {
    const params = newsroomTodaySearchParams(
      {
        landscape: 'landscape-1',
        range: '28d',
        start: '2026-07-01',
        end: '2026-07-28',
        platforms: 'instagram',
      },
      new Date('2026-08-06T02:30:00.000Z'),
    );

    assert.equal(params.range, undefined);
    assert.equal(params.start, '2026-08-05');
    assert.equal(params.end, '2026-08-05');
    assert.equal(params.landscape, 'landscape-1');
    assert.equal(params.platforms, 'instagram');
  });

  it('uses an exact rolling 24-hour window', () => {
    const now = new Date('2026-11-01T07:30:00.000Z');
    const range = newsroomTrailing24Hours(now);

    assert.equal(range.end.toISOString(), now.toISOString());
    assert.equal(range.end.getTime() - range.start.getTime(), 86_400_000);
  });

  it('selects the highest-engagement post on every newsroom platform', () => {
    const post = (id: string, platform: PostDto['platform'], engagementTotal: number): PostDto => ({
      id,
      company: { id: 'company-1', name: 'Publisher', slug: 'publisher', logoUrl: null, color: null, segment: null },
      platform,
      type: 'photo',
      postedAt: '2026-08-06T12:00:00.000Z',
      text: null,
      permalink: null,
      thumbnailUrl: null,
      applause: engagementTotal,
      conversation: 0,
      amplification: 0,
      saves: 0,
      views: 0,
      engagementTotal,
      engagementRateByFollower: 0,
      followersAtPost: null,
      tags: [],
      urls: [],
      medianEngagement: null,
      outlierScore: null,
    });

    const winners = newsroomPlatformWinners([
      post('facebook-low', 'facebook', 10),
      post('instagram', 'instagram', 20),
      post('facebook-high', 'facebook', 30),
    ]);

    assert.deepEqual(winners.map(({ platform }) => platform), NEWSROOM_PLATFORMS);
    assert.equal(winners.find(({ platform }) => platform === 'facebook')?.post?.id, 'facebook-high');
    assert.equal(winners.find(({ platform }) => platform === 'instagram')?.post?.id, 'instagram');
    assert.equal(winners.find(({ platform }) => platform === 'linkedin')?.post, null);
  });

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
