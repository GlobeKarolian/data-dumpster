import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { changeIsRounded, readingPrecision, roundingStep } from './source-rounding';

describe('source rounding', () => {
  it('measures the step a reading sits on', () => {
    // 1,400,000 divides by 100k but not by a million.
    assert.equal(roundingStep(1_400_000), 100_000);
    assert.equal(roundingStep(1_300_000), 100_000);
    assert.equal(roundingStep(34_700), 100);
    assert.equal(roundingStep(431_529), 1);
    assert.equal(roundingStep(0), 1);
  });

  it('expresses precision relative to the value itself', () => {
    // 100k on 1.3M cannot support a weekly delta of a few thousand.
    assert.ok(readingPrecision(1_300_000) >= 0.05);
    // 100 on 34,700 comfortably can.
    assert.ok(readingPrecision(34_700) < 0.01);
  });

  it('flags the Boston 25 Facebook jump, which was one bucket flip', () => {
    assert.equal(changeIsRounded(1_300_000, 1_400_000), true);
  });

  it('flags a flat rounded reading, where real movement is invisible', () => {
    assert.equal(changeIsRounded(1_400_000, 1_400_000), true);
  });

  it('leaves precise readings alone however large the brand', () => {
    assert.equal(changeIsRounded(429_231, 431_529), false);
    assert.equal(changeIsRounded(385_402, 388_767), false);
    assert.equal(changeIsRounded(2_220_034, 2_515_672), false);
  });

  it('does not flag a move far larger than the rounding step', () => {
    // 1.3M to 2.0M is seven buckets: rounding cannot have produced that.
    assert.equal(changeIsRounded(1_300_000, 2_000_000), false);
  });

  it('says nothing when either endpoint is missing', () => {
    assert.equal(changeIsRounded(null, 1_400_000), false);
    assert.equal(changeIsRounded(1_400_000, null), false);
  });
});
