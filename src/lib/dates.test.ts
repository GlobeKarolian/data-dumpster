import assert from 'node:assert/strict';
import test from 'node:test';
import { endOfDay, startOfDay } from 'date-fns';
import { formatFullDate } from '@/components/ui/format';
import { parseLocalDay, parseRangeParams } from './dates';

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
