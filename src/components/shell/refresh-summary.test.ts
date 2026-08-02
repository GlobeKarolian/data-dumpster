import assert from 'node:assert/strict';
import test from 'node:test';
import { mergeRefreshSummaries, type RefreshRunSummary } from './refresh-summary';

function summary(overrides: Partial<RefreshRunSummary>): RefreshRunSummary {
  return {
    attempted: 0,
    succeeded: 0,
    failed: 0,
    skipped: 0,
    partial: 0,
    postsUpserted: 0,
    durationMs: 0,
    remaining: 0,
    blocked: 0,
    complete: false,
    ...overrides,
  };
}

test('keeps every batch outcome while using the newest durable queue state', () => {
  const first = summary({
    attempted: 24,
    succeeded: 20,
    failed: 4,
    postsUpserted: 100,
    durationMs: 5_000,
    remaining: 30,
    blocked: 4,
    results: [{ companyName: 'A', handle: 'a', platform: 'facebook', status: 'failed', error: 'inactive' }],
  });
  const second = summary({
    attempted: 20,
    succeeded: 19,
    partial: 1,
    postsUpserted: 50,
    durationMs: 3_000,
    remaining: 5,
    blocked: 4,
  });

  const merged = mergeRefreshSummaries(first, second);
  assert.equal(merged.attempted, 44);
  assert.equal(merged.succeeded, 39);
  assert.equal(merged.failed, 4);
  assert.equal(merged.partial, 1);
  assert.equal(merged.postsUpserted, 150);
  assert.equal(merged.durationMs, 8_000);
  assert.equal(merged.remaining, 5);
  assert.equal(merged.blocked, 4);
  assert.equal(merged.results?.[0]?.error, 'inactive');
});
