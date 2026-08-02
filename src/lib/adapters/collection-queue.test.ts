import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { collectionQueueTestHelpers } from './collection-queue';

const { collectionRunSince } = collectionQueueTestHelpers;

describe('durable collection windows', () => {
  const requiredSince = new Date('2026-05-01T00:00:00Z');
  const coverageUntil = new Date('2026-07-30T12:00:00Z');

  it('uses a two-day overlap after the historical window is complete', () => {
    assert.equal(collectionRunSince({
      requiredSince,
      coverageSince: requiredSince,
      coverageUntil,
      hasMore: false,
    }).toISOString(), '2026-07-28T12:00:00.000Z');
  });

  it('keeps the full requested window while pagination remains', () => {
    assert.equal(collectionRunSince({
      requiredSince,
      coverageSince: requiredSince,
      coverageUntil,
      hasMore: true,
    }).toISOString(), requiredSince.toISOString());
  });

  it('backfills from the new boundary when the requested history expands', () => {
    const expandedSince = new Date('2026-01-01T00:00:00Z');
    assert.equal(collectionRunSince({
      requiredSince: expandedSince,
      coverageSince: requiredSince,
      coverageUntil,
      hasMore: false,
    }).toISOString(), expandedSince.toISOString());
  });
});
