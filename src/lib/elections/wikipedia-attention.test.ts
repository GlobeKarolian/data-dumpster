import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { dayStamp, parsePageviews } from './wikipedia-attention';

describe('wikipedia attention parsing', () => {
  it('converts API timestamps to calendar days and keeps counts', () => {
    const days = parsePageviews({
      items: [
        { timestamp: '2026081700', views: 12345, agent: 'user' },
        { timestamp: '2026081800', views: 999, agent: 'user' },
      ],
    });
    assert.deepEqual(days, [
      { day: '2026-08-17', views: 12345 },
      { day: '2026-08-18', views: 999 },
    ]);
  });

  it('drops malformed items instead of charting them', () => {
    const days = parsePageviews({
      items: [
        { timestamp: 'garbage', views: 5 },
        { timestamp: '2026081700', views: -3 },
        { timestamp: '2026081700', views: 'many' },
        { timestamp: '2026081800', views: 7 },
      ],
    });
    assert.deepEqual(days, [{ day: '2026-08-18', views: 7 }]);
  });

  it('treats a non-list payload as an empty series, never a throw', () => {
    assert.deepEqual(parsePageviews(null), []);
    assert.deepEqual(parsePageviews({ items: 'nope' }), []);
  });

  it('stamps days in the format the pageviews path expects', () => {
    assert.equal(dayStamp(new Date('2026-08-18T15:30:00Z')), '20260818');
  });
});
