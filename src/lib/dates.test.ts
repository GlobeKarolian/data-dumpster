import assert from 'node:assert/strict';
import test, { describe, it } from 'node:test';
import { endOfDay, startOfDay } from 'date-fns';
import { formatFullDate } from '@/components/ui/format';
import {
  dayStrings, daysIn, parseLocalDay, parseRangeParams, presetRange, previousRange, toDayString,
} from './dates';

function inBostonTime<T>(run: () => T): T {
  const previous = process.env.TZ;
  process.env.TZ = 'America/New_York';
  try {
    return run();
  } finally {
    if (previous === undefined) delete process.env.TZ;
    else process.env.TZ = previous;
  }
}

test('date-only values stay on their local calendar day', () => {
  inBostonTime(() => {
    const parsed = parseLocalDay('2026-07-01');
    assert.ok(parsed);
    assert.equal(parsed.getFullYear(), 2026);
    assert.equal(parsed.getMonth(), 6);
    assert.equal(parsed.getDate(), 1);
    assert.equal(parsed.getHours(), 0);
    assert.equal(parsed.toISOString(), '2026-07-01T04:00:00.000Z');
    assert.equal(formatFullDate('2026-07-01'), 'Jul 1, 2026');
  });
});

test('URL date windows start and end on the requested local days', () => {
  inBostonTime(() => {
    const range = parseRangeParams(new URLSearchParams('start=2026-07-01&end=2026-07-29'));
    assert.equal(range.start.getTime(), startOfDay(new Date(2026, 6, 1)).getTime());
    assert.equal(range.end.getTime(), endOfDay(new Date(2026, 6, 29)).getTime());
  });
});

test('invalid date-only values fall back instead of rolling into another day', () => {
  assert.equal(parseLocalDay('2026-02-30'), null);
  assert.equal(parseLocalDay('July 1, 2026'), null);
});

/* ------------------------------------------------- zone independence */

describe('windows are computed in the report zone, not the server zone', () => {
  const asUtc = (d: Date) => d.toISOString();

  it('a preset window starts at Eastern midnight regardless of server TZ', () => {
    // 2026-07-15 in July is EDT, UTC-4. Eastern midnight is 04:00Z.
    const now = new Date('2026-07-15T18:00:00.000Z');
    const r = presetRange(7, now);
    assert.equal(asUtc(r.start), '2026-07-09T04:00:00.000Z');
    assert.equal(asUtc(r.end), '2026-07-16T03:59:59.999Z');
    assert.equal(daysIn(r), 7);
  });

  it('a post just after Eastern midnight lands on the day the chart shows', () => {
    // 00:30 Eastern on 2026-07-15 is 04:30Z. Under a UTC server this formatted
    // as 2026-07-15 while SQL bucketed it to 2026-07-15 too, but the axis was
    // generated from UTC days, so the boundary posts fell off the chart.
    const justAfterMidnightEastern = new Date('2026-07-15T04:30:00.000Z');
    assert.equal(toDayString(justAfterMidnightEastern), '2026-07-15');

    // 23:30 Eastern on 2026-07-15 is 03:30Z on the 16th.
    const lateEvening = new Date('2026-07-16T03:30:00.000Z');
    assert.equal(toDayString(lateEvening), '2026-07-15');
  });

  it('the day axis has no gaps and matches the window length', () => {
    const r = presetRange(7, new Date('2026-07-15T18:00:00.000Z'));
    const days = dayStrings(r);
    assert.equal(days.length, 7);
    assert.deepEqual(days, [
      '2026-07-09', '2026-07-10', '2026-07-11',
      '2026-07-12', '2026-07-13', '2026-07-14', '2026-07-15',
    ]);
  });

  it('survives the spring-forward transition without losing or repeating a day', () => {
    // DST began 2026-03-08 in the US.
    const r = presetRange(5, new Date('2026-03-10T18:00:00.000Z'));
    const days = dayStrings(r);
    assert.equal(days.length, 5);
    assert.deepEqual(days, [
      '2026-03-06', '2026-03-07', '2026-03-08', '2026-03-09', '2026-03-10',
    ]);
    assert.equal(new Set(days).size, 5, 'no repeated day across the transition');
  });

  it('survives the autumn fall-back transition', () => {
    // DST ended 2026-11-01 in the US.
    const r = presetRange(4, new Date('2026-11-02T18:00:00.000Z'));
    assert.deepEqual(dayStrings(r), [
      '2026-10-30', '2026-10-31', '2026-11-01', '2026-11-02',
    ]);
  });

  it('the previous window is the same length and does not overlap', () => {
    const r = presetRange(7, new Date('2026-07-15T18:00:00.000Z'));
    const p = previousRange(r);
    assert.equal(daysIn(p), daysIn(r));
    assert.ok(p.end < r.start, 'the comparison window must not overlap the current one');
    assert.equal(toDayString(p.end), '2026-07-08');
    assert.equal(toDayString(p.start), '2026-07-02');
  });

  it('rejects impossible calendar days rather than rolling them forward', () => {
    assert.equal(parseLocalDay('2026-02-31'), null);
    assert.equal(parseLocalDay('2026-13-01'), null);
    assert.ok(parseLocalDay('2026-07-15') !== null);
  });
});
