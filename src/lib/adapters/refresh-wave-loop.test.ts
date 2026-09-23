import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { runWavesWithinBudget } from './refresh-wave-loop';

describe('runWavesWithinBudget', () => {
  it('keeps running waves in the same invocation while time remains', async () => {
    let clock = 0;
    let remaining = 5;
    const result = await runWavesWithinBudget(async () => {
      clock += 10_000;
      remaining -= 1;
      return { dispatchNext: remaining > 0 };
    }, { budgetMs: 120_000, now: () => clock });
    assert.deepEqual(result, { waves: 5, dispatchNext: false },
      'a five-wave refresh should finish without a single self-dispatch');
  });

  it('stops starting new waves once the budget is spent and asks for one hand-off', async () => {
    let clock = 0;
    const result = await runWavesWithinBudget(async () => {
      clock += 50_000;
      return { dispatchNext: true };
    }, { budgetMs: 120_000, now: () => clock });
    assert.equal(result.waves, 3);
    assert.equal(result.dispatchNext, true);
  });

  it('stops when another worker holds the job', async () => {
    let calls = 0;
    const result = await runWavesWithinBudget(async () => {
      calls += 1;
      return { dispatchNext: false };
    });
    assert.equal(calls, 1);
    assert.equal(result.dispatchNext, false);
  });

  it('is bounded even with a frozen clock', async () => {
    const result = await runWavesWithinBudget(async () => ({ dispatchNext: true }), {
      now: () => 0,
      maxWaves: 7,
    });
    assert.equal(result.waves, 7);
  });
});
