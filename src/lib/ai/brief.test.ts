import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { BriefVerification } from './verify';
import { BriefVerificationError, briefTestHelpers } from './brief';

function verdict(ok: boolean): BriefVerification {
  return {
    ok,
    claims: [],
    unverified: ok ? [] : ['99 does not appear in the fact sheet'],
    violations: [],
    missingCaveats: [],
    miscited: [],
    stats: { total: ok ? 0 : 1, grounded: 0, cited: 0 },
    checkedAt: '2026-08-03T00:00:00.000Z',
  };
}

describe('brief fail-closed guard', () => {
  it('allows a fully verified brief', () => {
    assert.doesNotThrow(() => briefTestHelpers.requireVerifiedBrief(verdict(true)));
  });

  it('blocks unverified prose before it can be returned or persisted', () => {
    assert.throws(
      () => briefTestHelpers.requireVerifiedBrief(verdict(false)),
      (error) => error instanceof BriefVerificationError
        && /No brief was saved/.test(error.message),
    );
  });
});
