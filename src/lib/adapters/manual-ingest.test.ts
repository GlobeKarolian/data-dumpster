import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  executeManualIngest,
  groupManualIngestTargets,
  manualIngestWindow,
  type ManualIngestDependencies,
  type ManualIngestTarget,
} from './manual-ingest';

const trackedTarget: ManualIngestTarget = {
  channelId: 'channel-1',
  platform: 'youtube',
  handle: '@example',
  companyName: 'Example News',
  companySlug: 'example-news',
  lastIngestedAt: null,
  landscapeIds: ['landscape-1', 'landscape-2'],
  orgIds: ['org-1', 'org-2'],
};

const emptySummary = {
  attempted: 0,
  succeeded: 0,
  failed: 0,
  skipped: 0,
  partial: 0,
  postsUpserted: 0,
  durationMs: 0,
  remaining: 0,
  blocked: 0,
  sourceLimited: 0,
  complete: true,
  byPlatform: {},
  results: [],
};

describe('manual collection target planning', () => {
  it('collapses landscape rows before applying the channel limit', () => {
    const targets = groupManualIngestTargets([
      {
        channelId: 'channel-1', platform: 'youtube', handle: '@example',
        companyName: 'Example News', companySlug: 'example-news', lastIngestedAt: null,
        landscapeId: 'landscape-2', orgId: 'org-2',
      },
      {
        channelId: 'channel-1', platform: 'youtube', handle: '@example',
        companyName: 'Example News', companySlug: 'example-news', lastIngestedAt: null,
        landscapeId: 'landscape-1', orgId: 'org-1',
      },
      {
        channelId: 'channel-2', platform: 'youtube', handle: '@other',
        companyName: 'Other News', companySlug: 'other-news', lastIngestedAt: null,
        landscapeId: 'landscape-3', orgId: 'org-3',
      },
    ], 1);

    assert.equal(targets.length, 1);
    assert.deepEqual(targets[0]?.landscapeIds, ['landscape-1', 'landscape-2']);
    assert.deepEqual(targets[0]?.orgIds, ['org-1', 'org-2']);
  });

  it('defaults a new demand to the durable queue history window', () => {
    const until = new Date('2026-08-03T12:00:00.000Z');
    const window = manualIngestWindow({}, until);
    assert.equal(window.until.toISOString(), until.toISOString());
    assert.equal(window.since.toISOString(), '2026-05-05T12:00:00.000Z');
  });

  it('rejects an empty or reversed requested window', () => {
    const at = new Date('2026-08-03T00:00:00.000Z');
    assert.throws(() => manualIngestWindow({ since: at, until: at }), /earlier than until/);
    assert.throws(() => manualIngestWindow({
      since: new Date('2026-08-04T00:00:00.000Z'),
      until: at,
    }), /earlier than until/);
  });
});

describe('manual collection execution', () => {
  it('makes dry-run a read-only preview that cannot reach the queue or vendors', async () => {
    let enqueueCalled = false;
    let queueCalled = false;
    const dependencies: ManualIngestDependencies = {
      resolveTargets: async () => [trackedTarget],
      enqueueChannelCollection: async () => {
        enqueueCalled = true;
        throw new Error('dry-run attempted a write');
      },
      runCollectionQueue: async () => {
        queueCalled = true;
        throw new Error('dry-run attempted a vendor-capable queue run');
      },
    };

    const result = await executeManualIngest({
      selection: { platforms: ['youtube'] },
      dryRun: true,
      now: new Date('2026-08-03T12:00:00.000Z'),
    }, dependencies);

    assert.equal(enqueueCalled, false);
    assert.equal(queueCalled, false);
    assert.equal(result.registrationCalls, 0);
    assert.equal(result.summary, undefined);
  });

  it('registers every sharing organization before one leased channel claim', async () => {
    const events: string[] = [];
    const since = new Date('2026-07-01T00:00:00.000Z');
    const until = new Date('2026-08-01T00:00:00.000Z');
    const dependencies: ManualIngestDependencies = {
      resolveTargets: async () => [trackedTarget],
      enqueueChannelCollection: async (input) => {
        events.push('enqueue:' + input.orgId);
        assert.equal(input.channelId, trackedTarget.channelId);
        assert.equal(input.force, input.orgId === 'org-1');
        assert.equal(input.since, since);
        assert.equal(input.until, until);
        return 1;
      },
      runCollectionQueue: async (input) => {
        events.push('run');
        assert.deepEqual(input.channelIds, [trackedTarget.channelId]);
        assert.deepEqual(input.platforms, ['youtube']);
        assert.equal(input.maxChannels, 1);
        assert.equal(input.postLimit, 250);
        assert.equal(input.concurrency, 3);
        assert.equal(input.useRequiredSince, true);
        assert.deepEqual(input.runWindow, { since, until });
        return emptySummary;
      },
    };

    const result = await executeManualIngest({
      selection: { platforms: ['youtube'] },
      dryRun: false,
      since,
      until,
      postLimit: 250,
      concurrency: 3,
    }, dependencies);

    assert.deepEqual(events, ['enqueue:org-1', 'enqueue:org-2', 'run']);
    assert.equal(result.registrationCalls, 2);
    assert.equal(result.queueSignals, 2);
    assert.equal(result.summary, emptySummary);
  });

  it('refuses to run an orphaned channel without a live landscape demand', async () => {
    const orphan = { ...trackedTarget, landscapeIds: [], orgIds: [] };
    let queueCalled = false;
    const result = await executeManualIngest({
      selection: {},
      dryRun: false,
      now: new Date('2026-08-03T12:00:00.000Z'),
    }, {
      resolveTargets: async () => [orphan],
      enqueueChannelCollection: async () => {
        throw new Error('orphan attempted demand registration');
      },
      runCollectionQueue: async () => {
        queueCalled = true;
        return emptySummary;
      },
    });

    assert.equal(queueCalled, false);
    assert.deepEqual(result.untrackedTargets, [orphan]);
    assert.equal(result.summary, undefined);
  });
});
