import assert from 'node:assert/strict';
import test from 'node:test';
import {
  collectionStateOf,
  summarizeCollectionHealth,
  type ChannelRecord,
  type CompanySources,
} from './sources-manager';

function channel(overrides: Partial<ChannelRecord> = {}): ChannelRecord {
  return {
    id: 'channel-1',
    platform: 'facebook',
    handle: 'example',
    profileUrl: null,
    active: true,
    isOwned: false,
    lastIngestedAt: '2026-07-31T12:00:00Z',
    lastRunStatus: 'succeeded',
    lastRunError: null,
    collectionStatus: 'succeeded',
    collectionRequiredSince: '2026-05-01T00:00:00Z',
    collectionRequiredUntil: '2026-07-31T00:00:00Z',
    collectionCoverageSince: '2026-05-01T00:00:00Z',
    collectionCoverageUntil: '2026-07-31T00:00:00Z',
    collectionAttempts: 1,
    collectionNextAttemptAt: null,
    collectionLeaseUntil: null,
    collectionHasMore: false,
    collectionLastError: null,
    collectionUpdatedAt: '2026-07-31T12:00:00Z',
    postCount: 10,
    ...overrides,
  };
}

test('requires durable bounds covering the entire requested window', () => {
  assert.equal(collectionStateOf(channel()).health, 'complete');
  assert.equal(collectionStateOf(channel({
    collectionCoverageSince: '2026-05-02T00:00:00Z',
  })).health, 'blocked');
  assert.equal(collectionStateOf(channel({ collectionHasMore: true })).health, 'blocked');
});

test('treats an expired worker lease as blocked', () => {
  const state = collectionStateOf(channel({
    collectionStatus: 'running',
    collectionLeaseUntil: '2026-07-31T11:00:00Z',
  }), Date.parse('2026-07-31T12:00:00Z'));

  assert.equal(state.health, 'blocked');
  assert.equal(state.label, 'Stalled');
});

test('groups vendor failures and excludes unavailable legacy profiles from active totals', () => {
  const company: CompanySources = {
    id: 'company-1',
    name: 'Example',
    manageable: true,
    channels: [
      channel({
        collectionStatus: 'failed',
        collectionCoverageSince: null,
        collectionCoverageUntil: null,
        collectionLastError: 'Bright Data: HTTP 400. Customer is not active',
      }),
      channel({ id: 'linkedin', platform: 'linkedin', handle: 'example', active: false }),
      channel({ id: 'reddit', platform: 'reddit', handle: 'r/example', active: false }),
    ],
  };

  const summary = summarizeCollectionHealth([company]);
  assert.equal(summary.total, 1);
  assert.equal(summary.blocked, 1);
  assert.equal(summary.paused, 2);
  assert.equal(summary.blockedCauses[0]?.key, 'vendor-access');
});
