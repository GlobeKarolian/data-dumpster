import assert from 'node:assert/strict';
import test from 'node:test';
import {
  changeRatio, daysInWindow, fromEpochMs, priorWindow, windowIsComparable,
  windowIsFullyCollected,
} from './comparability';

const day = (iso: string): Date => new Date(iso + 'T00:00:00Z');

test('the prior window is the same length, immediately before', () => {
  const prior = priorWindow({ start: day('2026-08-17'), end: day('2026-08-24') });
  assert.equal(prior.start.toISOString(), day('2026-08-10').toISOString());
  assert.equal(prior.end.toISOString(), day('2026-08-17').toISOString());
});

test('change is a fraction, not a percent', () => {
  // Handing a percent to formatChange, which multiplies by 100 and calls
  // anything over 10 ">1000%", printed ">1000%" on a twelve percent move.
  assert.equal(changeRatio(112, 100), 0.12);
  assert.equal(changeRatio(50, 100), -0.5);
});

test('no baseline yields no percentage rather than an invented one', () => {
  assert.equal(changeRatio(224, 0), null);
  assert.equal(changeRatio(0, 0), null);
});

test('a window running past the last collected day is not comparable', () => {
  // The real case that shipped wrong: asked for the last seven days on August
  // 24 while collection had been paused since August 20.
  const comparable = windowIsComparable(
    { start: day('2026-08-17'), end: day('2026-08-24') },
    { firstPost: day('2018-07-07'), lastPost: day('2026-08-20') },
  );
  assert.equal(comparable, false);
});

test('a window inside collection is comparable', () => {
  const comparable = windowIsComparable(
    { start: day('2026-08-13'), end: day('2026-08-20') },
    { firstPost: day('2018-07-07'), lastPost: day('2026-08-20') },
  );
  assert.equal(comparable, true);
});

test('collection lagging the clock by hours is still comparable', () => {
  const comparable = windowIsComparable(
    { start: day('2026-08-13'), end: day('2026-08-20') },
    { firstPost: day('2018-07-07'), lastPost: new Date('2026-08-19T18:00:00Z') },
  );
  assert.equal(comparable, true);
});

test('a prior window predating collection is not comparable', () => {
  const comparable = windowIsComparable(
    { start: day('2018-07-10'), end: day('2018-07-17') },
    { firstPost: day('2018-07-07'), lastPost: day('2026-08-20') },
  );
  assert.equal(comparable, false);
});

test('a window with a hole in the middle is not fully collected', () => {
  // The case that shipped: the collector spent four days paused, resumed, and
  // the fresh leading edge satisfied every edge check while three days of the
  // window held nothing. The page reported chatter down 34 percent.
  const w = { start: day('2026-08-18'), end: day('2026-08-25') };
  assert.equal(daysInWindow(w), 7);
  assert.equal(windowIsFullyCollected(w, 4), false);
  assert.equal(windowIsFullyCollected(w, 7), true);
});

test('the day still in progress does not count as a hole', () => {
  const w = { start: day('2026-08-18'), end: day('2026-08-25') };
  assert.equal(windowIsFullyCollected(w, 6), true);
});

test('epoch milliseconds arrive as a real date, whether string or number', () => {
  // The driver hands back a bigint as a string, and Number() on it is exact
  // well past any timestamp we will ever store.
  const ms = Date.UTC(2026, 7, 20, 23, 21, 25);
  assert.equal(fromEpochMs(ms)?.toISOString(), new Date(ms).toISOString());
  assert.equal(fromEpochMs(String(ms))?.toISOString(), new Date(ms).toISOString());
});

test('a missing timestamp is null, not an invalid date', () => {
  // The bug this replaces produced an Invalid Date, which is truthy, compares
  // false against everything, and made coverage checks quietly no-ops.
  for (const empty of [null, undefined, '']) {
    assert.equal(fromEpochMs(empty), null);
  }
  assert.equal(fromEpochMs('2018-07-07 14:23:00+00'), null);
});

test('an empty corpus is never comparable', () => {
  assert.equal(
    windowIsComparable(
      { start: day('2026-08-17'), end: day('2026-08-24') },
      { firstPost: null, lastPost: null },
    ),
    false,
  );
});
