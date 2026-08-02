import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { RateGate } from './rate-gate';

function fakeGate(callsPerWindow: number, windowSeconds: number) {
  let now = 0;
  const gate = new RateGate(callsPerWindow, windowSeconds, {
    now: () => now,
    sleep: async (ms) => { now += ms; },
  });
  return { gate, advance: (ms: number) => { now += ms; } };
}

describe('RateGate', () => {
  it('defers without taking tokens when the required wait exceeds the request budget', async () => {
    const { gate } = fakeGate(4, 4);
    const first = await gate.acquire(4, 0);
    assert.equal(first.acquired, true);

    const deferred = await gate.acquire(4, 999);
    assert.deepEqual(deferred, {
      acquired: false,
      reserved: 0,
      waitedMs: 0,
      retryAfterMs: 4_000,
    });
  });

  it('waits and rechecks the bucket before reserving', async () => {
    const { gate } = fakeGate(4, 4);
    await gate.acquire(4, 0);

    const next = await gate.acquire(4, 4_000);
    assert.deepEqual(next, {
      acquired: true,
      reserved: 4,
      waitedMs: 4_000,
      retryAfterMs: 0,
    });
  });

  it('refunds an estimate so the bucket is charged for actual calls only', async () => {
    const { gate } = fakeGate(8, 8);
    const first = await gate.acquire(4, 0);
    gate.reconcile(first.reserved, 1);
    const second = await gate.acquire(4, 0);
    gate.reconcile(second.reserved, 1);

    // Two measured calls consumed two of eight tokens, so only two seconds of
    // refill are needed before another full-capacity reservation.
    assert.equal(gate.waitFor(8), 2_000);
  });

  it('keeps call debt when a run costs more than its reservation', async () => {
    const { gate, advance } = fakeGate(8, 8);
    const reservation = await gate.acquire(4, 0);
    gate.reconcile(reservation.reserved, 10);

    assert.equal(gate.waitFor(4), 6_000);
    advance(6_000);
    assert.equal(gate.waitFor(4), 0);
  });
});
