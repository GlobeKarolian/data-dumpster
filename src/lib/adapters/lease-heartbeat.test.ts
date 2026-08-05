import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  leaseHeartbeatIntervalMs,
  type LeaseHeartbeatScheduler,
  TokenFencedLeaseHeartbeat,
} from './lease-heartbeat';

class ManualScheduler implements LeaseHeartbeatScheduler {
  private nextId = 1;
  private readonly jobs = new Map<number, {
    callback: () => Promise<void>;
    delayMs: number;
  }>();

  schedule(callback: () => Promise<void>, delayMs: number): number {
    const id = this.nextId++;
    this.jobs.set(id, { callback, delayMs });
    return id;
  }

  cancel(handle: unknown): void {
    if (typeof handle === 'number') this.jobs.delete(handle);
  }

  get pending(): number {
    return this.jobs.size;
  }

  get nextDelayMs(): number | undefined {
    return this.jobs.values().next().value?.delayMs;
  }

  async runNext(): Promise<void> {
    const next = this.jobs.entries().next().value as
      | [number, { callback: () => Promise<void>; delayMs: number }]
      | undefined;
    if (!next) throw new Error('No scheduled heartbeat.');
    this.jobs.delete(next[0]);
    await next[1].callback();
  }
}

describe('token-fenced lease heartbeat', () => {
  it('renews at one third of the lease and keeps the cadence below half', () => {
    const leaseMs = 6 * 60 * 1_000;
    const intervalMs = leaseHeartbeatIntervalMs(leaseMs);
    assert.equal(intervalMs, 2 * 60 * 1_000);
    assert.ok(intervalMs < leaseMs / 2);
  });

  it('renews every still-active claim in one scheduled pulse', async () => {
    const scheduler = new ManualScheduler();
    const renewals: string[][] = [];
    const heartbeat = new TokenFencedLeaseHeartbeat({
      channelIds: ['channel-a', 'channel-b', 'channel-a'],
      leaseMs: 600,
      renew: async (channelIds) => {
        renewals.push([...channelIds]);
        return channelIds;
      },
      scheduler,
    });

    heartbeat.start();
    assert.equal(scheduler.pending, 1);
    assert.equal(scheduler.nextDelayMs, 200);

    await scheduler.runNext();
    assert.deepEqual(renewals, [['channel-a', 'channel-b']]);
    assert.equal(heartbeat.owns('channel-a'), true);
    assert.equal(heartbeat.owns('channel-b'), true);
    assert.equal(scheduler.pending, 1);

    assert.equal(await heartbeat.releaseForFinish('channel-a'), true);
    await scheduler.runNext();
    assert.deepEqual(renewals[1], ['channel-b']);

    assert.equal(await heartbeat.releaseForFinish('channel-b'), true);
    await heartbeat.stop();
    assert.equal(scheduler.pending, 0);
  });

  it('aborts only a channel omitted by the token-fenced renewal', async () => {
    const scheduler = new ManualScheduler();
    const heartbeat = new TokenFencedLeaseHeartbeat({
      channelIds: ['channel-a', 'channel-b'],
      leaseMs: 600,
      renew: async () => ['channel-a'],
      scheduler,
    });

    heartbeat.start();
    const signalA = heartbeat.signalFor('channel-a');
    const signalB = heartbeat.signalFor('channel-b');
    await scheduler.runNext();

    assert.equal(signalA.aborted, false);
    assert.equal(signalB.aborted, true);
    assert.equal(heartbeat.owns('channel-a'), true);
    assert.equal(heartbeat.owns('channel-b'), false);
    assert.equal(await heartbeat.releaseForFinish('channel-b'), false);
    assert.equal(await heartbeat.releaseForFinish('channel-a'), true);
    await heartbeat.stop();
  });

  it('waits for an in-flight renewal before releasing a row for final settlement', async () => {
    const scheduler = new ManualScheduler();
    let resolveRenewal: ((channelIds: readonly string[]) => void) | undefined;
    const heartbeat = new TokenFencedLeaseHeartbeat({
      channelIds: ['channel-a'],
      leaseMs: 600,
      renew: () => new Promise((resolve) => { resolveRenewal = resolve; }),
      scheduler,
    });

    heartbeat.start();
    const pulse = scheduler.runNext();
    let releaseResolved = false;
    const release = heartbeat.releaseForFinish('channel-a').then((owned) => {
      releaseResolved = true;
      return owned;
    });

    await Promise.resolve();
    assert.equal(releaseResolved, false);
    assert.ok(resolveRenewal);
    resolveRenewal(['channel-a']);
    await pulse;
    assert.equal(await release, true);
    await heartbeat.stop();
    assert.equal(scheduler.pending, 0);
  });

  it('fails closed and clears future timers when renewal itself fails', async () => {
    const scheduler = new ManualScheduler();
    const heartbeat = new TokenFencedLeaseHeartbeat({
      channelIds: ['channel-a', 'channel-b'],
      leaseMs: 600,
      renew: async () => { throw new Error('database unavailable'); },
      scheduler,
    });

    heartbeat.start();
    const signalA = heartbeat.signalFor('channel-a');
    const signalB = heartbeat.signalFor('channel-b');
    await scheduler.runNext();

    assert.equal(signalA.aborted, true);
    assert.equal(signalB.aborted, true);
    assert.equal(scheduler.pending, 0);
    assert.equal(await heartbeat.releaseForFinish('channel-a'), false);
    assert.equal(await heartbeat.releaseForFinish('channel-b'), false);
    await heartbeat.stop();
  });
});
