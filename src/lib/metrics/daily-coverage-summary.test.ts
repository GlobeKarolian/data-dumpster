import assert from 'node:assert/strict';
import test from 'node:test';
import {
  isScheduledCoverageFailure,
  summarizeDailyCoverage,
} from './daily-coverage-summary';

test('an empty demanded audience set is unscheduled, not a false success', () => {
  assert.deepEqual(summarizeDailyCoverage(0, 0), { ratio: 0, complete: false });
});

test('daily coverage remains bounded and uses the 98 percent threshold', () => {
  assert.deepEqual(summarizeDailyCoverage(100, 98), { ratio: 0.98, complete: true });
  assert.deepEqual(summarizeDailyCoverage(100, 97), { ratio: 0.97, complete: false });
  assert.deepEqual(summarizeDailyCoverage(2, 3), { ratio: 1, complete: true });
});

test('health ignores unscheduled days and counts only real scheduled gaps', () => {
  assert.equal(isScheduledCoverageFailure({ activeChannels: 0, complete: false }), false);
  assert.equal(isScheduledCoverageFailure({ activeChannels: 100, complete: true }), false);
  assert.equal(isScheduledCoverageFailure({ activeChannels: 100, complete: false }), true);
});
