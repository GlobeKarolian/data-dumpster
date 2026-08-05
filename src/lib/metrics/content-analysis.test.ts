import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { buildActivityByDay } from './content-analysis';

describe('buildActivityByDay', () => {
  it('uses the canonical mean of per-post follower rates for daily trends', () => {
    const points = buildActivityByDay([
      {
        companyId: 'focus', companyName: 'Focus', platform: 'instagram', type: 'photo',
        postedAt: new Date('2026-07-01T14:00:00.000Z'), text: null, hashtags: [],
        engagementTotal: 100, followersAtPost: 1_000,
      },
      {
        companyId: 'focus', companyName: 'Focus', platform: 'instagram', type: 'photo',
        postedAt: new Date('2026-07-01T15:00:00.000Z'), text: null, hashtags: [],
        engagementTotal: 100, followersAtPost: 100,
      },
      {
        companyId: 'other', companyName: 'Other', platform: 'instagram', type: 'photo',
        postedAt: new Date('2026-07-01T16:00:00.000Z'), text: null, hashtags: [],
        engagementTotal: 10, followersAtPost: 100,
      },
    ], 'focus', {
      start: new Date('2026-07-01T04:00:00.000Z'),
      end: new Date('2026-07-02T03:59:59.999Z'),
    }, 2);

    assert.equal(points.length, 1);
    assert.equal(points[0].focusRate, (0.1 + 1) / 2);
    assert.equal(points[0].landscapeRate, (0.1 + 1 + 0.1) / 3);
    assert.notEqual(points[0].focusRate, 200 / 1_100,
      'pooled engagement over pooled followers is a different metric');
  });

  it('returns null for an unmeasured day instead of drawing a zero rate', () => {
    const points = buildActivityByDay([], 'focus', {
      start: new Date('2026-07-01T04:00:00.000Z'),
      end: new Date('2026-07-02T03:59:59.999Z'),
    }, 2);

    assert.deepEqual(points.map((point) => point.focusRate), [null]);
    assert.deepEqual(points.map((point) => point.landscapeRate), [null]);
  });
});
