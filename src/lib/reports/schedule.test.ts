import assert from 'node:assert/strict';
import test from 'node:test';
import {
  isScheduleDue,
  lastCompleteWeekInZone,
  reportRunIdempotencyKeySchema,
  scheduleWindow,
} from './schedule';

const mondayEight = {
  dayOfWeek: 1,
  hour: 8,
  timeZone: 'America/New_York',
};

test('scheduleWindow honors the schedule time zone', () => {
  assert.deepEqual(
    scheduleWindow(mondayEight, new Date('2026-07-27T12:05:00.000Z')),
    {
      localDate: '2026-07-27',
      key: '2026-07-27T08:00[America/New_York]',
    },
  );
});

test('scheduleWindow stays on the prior week before the local delivery hour', () => {
  assert.equal(
    scheduleWindow(mondayEight, new Date('2026-07-27T11:59:00.000Z')).localDate,
    '2026-07-20',
  );
});

test('isScheduleDue runs once for a weekly window', () => {
  const now = new Date('2026-07-27T12:05:00.000Z');
  assert.equal(isScheduleDue({ ...mondayEight, enabled: true, lastRunAt: null }, now), true);
  assert.equal(
    isScheduleDue({
      ...mondayEight,
      enabled: true,
      lastRunAt: new Date('2026-07-27T12:01:00.000Z'),
    }, now),
    false,
  );
  assert.equal(
    isScheduleDue({
      ...mondayEight,
      enabled: true,
      lastRunAt: new Date('2026-07-20T12:01:00.000Z'),
    }, now),
    true,
  );
});

test('disabled schedules are never due', () => {
  assert.equal(isScheduleDue({ ...mondayEight, enabled: false, lastRunAt: null }), false);
});

test('a new schedule waits for its first configured clock tick', () => {
  const schedule = {
    ...mondayEight,
    enabled: true,
    lastRunAt: null,
    createdAt: new Date('2026-07-27T11:00:00.000Z'),
  };

  assert.equal(isScheduleDue(schedule, new Date('2026-07-27T11:30:00.000Z')), false);
  assert.equal(isScheduleDue(schedule, new Date('2026-07-27T12:00:00.000Z')), true);
});

test('lastCompleteWeekInZone never includes the current Monday', () => {
  assert.deepEqual(
    lastCompleteWeekInZone(new Date('2026-07-27T12:05:00.000Z'), 'America/New_York'),
    { start: '2026-07-20', end: '2026-07-26' },
  );
});

test('manual report runs require a stable, header-safe idempotency key', () => {
  const key = '12430db8-333e-4a8e-886d-f022c7f7f03e';
  assert.equal(reportRunIdempotencyKeySchema.parse(key), key);
  assert.equal(reportRunIdempotencyKeySchema.safeParse('short').success, false);
  assert.equal(reportRunIdempotencyKeySchema.safeParse('unsafe key').success, false);
});
