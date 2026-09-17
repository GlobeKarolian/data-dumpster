import assert from 'node:assert/strict';
import { test } from 'node:test';
import { canonicalState, transitionUrl, rangeFor, scopeMatches } from './state';

test('scope changes preserve the date and reset pagination and inspector', () => {
  const state = canonicalState(new URLSearchParams('landscape=a&range=28d&page=8&post=p&q=city&platforms=instagram'));
  const url = new URL(transitionUrl('/v2/posts', state, { companies: 'b' }), 'https://local');
  assert.equal(url.searchParams.get('range'), '28d');
  assert.equal(url.searchParams.get('q'), 'city');
  assert.equal(url.searchParams.get('page'), null);
  assert.equal(url.searchParams.get('post'), null);
  assert.equal(url.searchParams.get('companies'), 'b');
});
test('landscape changes clear company but not platform', () => {
  const url = transitionUrl('/v2', canonicalState(new URLSearchParams('companies=c&platforms=twitter')), { landscape: 'new' });
  assert(!url.includes('companies=')); assert(url.includes('platforms=twitter'));
});
test('invalid state is bounded and unknown filters cannot leak into reads', () => {
  const s = canonicalState(new URLSearchParams('range=evil&page=NaN&sort=DROP&platforms=rss&tags=secret'));
  assert.equal(s.range, '7d'); assert.equal(s.page, 1); assert.equal(s.sort, 'engagementTotal');
  assert.equal(s.platforms, ''); assert(!('tags' in s));
});
test('today is exactly 24 hours and calendar presets use Eastern boundaries', () => {
  const now = new Date('2026-03-09T15:00:00Z');
  const today = rangeFor(canonicalState(new URLSearchParams()), true, now);
  assert.equal(+today.end - +today.start, 86400000);
  const week = rangeFor(canonicalState(new URLSearchParams('range=7d')), false, now);
  assert.equal(week.start.toISOString(), '2026-03-03T05:00:00.000Z');
  assert.equal(week.end.toISOString(), '2026-03-10T03:59:59.999Z');
});
test('a newly selected preset supersedes stale hidden custom dates in native forms', () => {
  const state = canonicalState(new URLSearchParams('range=28d&start=2026-01-01&end=2026-01-03'));
  assert.equal(state.range, '28d'); assert.equal(state.start, ''); assert.equal(state.end, '');
});
test('Today drill-through pins the exact 24-hour publication window', () => {
  const s = canonicalState(new URLSearchParams('range=24h&at=2026-09-16T14%3A00%3A00.000Z'));
  const r = rangeFor(s, false, new Date('2026-09-17T20:00:00Z'));
  assert.equal(r.start.toISOString(), '2026-09-15T14:00:00.000Z');
  assert.equal(r.end.toISOString(), '2026-09-16T14:00:00.000Z');
  const url = transitionUrl('/v2/posts', s, { companies: 'a' });
  assert.equal(new URL(url, 'https://local').searchParams.get('at'), '2026-09-16T14:00:00.000Z');
});
test('explicit unknown landscape is refused, not silently substituted', () => {
  assert.equal(scopeMatches('nope', { id: 'a', slug: 'allowed' }), false);
  assert.equal(scopeMatches('allowed', { id: 'a', slug: 'allowed' }), true);
  assert.equal(scopeMatches('', null), true);
});
