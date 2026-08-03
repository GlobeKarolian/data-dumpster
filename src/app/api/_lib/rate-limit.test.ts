import assert from 'node:assert/strict';
import { describe, it, beforeEach } from 'node:test';
import { checkRateLimit, LIMITS, __resetRateLimits } from './rate-limit';

describe('checkRateLimit', () => {
  beforeEach(() => __resetRateLimits());

  it('allows up to the limit and refuses the next one', () => {
    for (let i = 0; i < LIMITS.ai.limit; i += 1) {
      assert.equal(checkRateLimit('org-a', LIMITS.ai).ok, true, `call ${i + 1}`);
    }
    const refused = checkRateLimit('org-a', LIMITS.ai);
    assert.equal(refused.ok, false);
    assert.ok(refused.ok === false && refused.retryAfterSeconds > 0);
  });

  it('meters each org separately, so one tenant cannot lock out another', () => {
    for (let i = 0; i < LIMITS.ai.limit; i += 1) checkRateLimit('noisy', LIMITS.ai);
    assert.equal(checkRateLimit('noisy', LIMITS.ai).ok, false);
    assert.equal(checkRateLimit('quiet', LIMITS.ai).ok, true);
  });

  it('keeps separate budgets per endpoint', () => {
    for (let i = 0; i < LIMITS.ingest.limit; i += 1) checkRateLimit('org-c', LIMITS.ingest);
    assert.equal(checkRateLimit('org-c', LIMITS.ingest).ok, false);
    // Same org, different budget: inference is not blocked by ingest spend.
    assert.equal(checkRateLimit('org-c', LIMITS.ai).ok, true);
  });

  it('the ingest budget is tighter than the inference budget', () => {
    assert.ok(LIMITS.ingest.limit < LIMITS.ai.limit,
      'a full refresh is minutes of vendor spend and must be the tightest');
  });
});
