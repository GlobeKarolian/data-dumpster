import assert from 'node:assert/strict';
import { test } from 'node:test';
import { metricText, deltaText, qualityLabel, neighborId, mayNavigate, observedCounter, safeWebUrl } from './presentation';
import type { MetricRow } from '@/lib/types';
const row: MetricRow = { company: { id: 'a', name: 'A', slug: 'a' }, value: 0, available: true, complete: false, rank: 1, changePct: .1, previousAvailable: true, previousComplete: true, previousValue: 2 };
test('counts, averages and fractional percentages are different units', () => {
  assert.equal(metricText('posts', 1234), '1,234');
  assert.equal(metricText('postsPerDay', 1.234), '1.23');
  assert.equal(metricText('engagementRateByFollower', .01234), '1.234%');
  assert.equal(metricText('posts', 0, false), '—');
  assert.equal(metricText('posts', NaN), '—');
});
test('delta requires both complete measured periods and positive baseline', () => {
  assert.equal(deltaText(row), '—');
  assert.equal(deltaText({ ...row, complete: true }), '+10.0%');
  assert.equal(deltaText({ ...row, complete: true, previousValue: 0 }), '—');
  assert.equal(deltaText({ ...row, complete: true, changeFromRoundedSource: true }), '—');
  assert.equal(qualityLabel(row), 'Observed only');
  assert.equal(qualityLabel({ ...row, available: false }), 'Unavailable');
});
test('selection follows real page order without wrapping or navigating inside controls', () => {
  assert.equal(neighborId(['a','b'], 'a', 1), 'b');
  assert.equal(neighborId(['a','b'], 'a', -1), null);
  assert.equal(neighborId(['a','b'], 'missing', 1), null);
  assert.equal(mayNavigate('INPUT', false), false);
  assert.equal(mayNavigate('DIV', true), false);
  assert.equal(mayNavigate('BUTTON', false), false);
  assert.equal(mayNavigate('BODY', false), true);
});
test('unavailable stored zeros and unsafe URLs do not pretend to be evidence', () => {
  assert.equal(observedCounter(0), '—'); assert.equal(observedCounter(4), '4');
  assert.equal(safeWebUrl('javascript:alert(1)'), null);
  assert.equal(safeWebUrl('https://example.com/post'), 'https://example.com/post');
});
