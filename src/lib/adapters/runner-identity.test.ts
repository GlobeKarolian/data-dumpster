import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  canDeferBoundInstagramIdentity,
  canRetainStoredInstagramIdentity,
  canWithholdUnverifiedInstagramObservations,
  canDeferIdentityForEmptyContinuation,
  cursorPersistenceFailureOutcome,
  stableIdentityDecision,
} from './runner';

const base = {
  channelId: 'channel-current',
  platform: 'instagram' as const,
  handle: 'BostonGlobe',
};

describe('pooled runner stable-identity gate', () => {
  it('does nothing when a fetch did not include profile identity', () => {
    assert.deepEqual(stableIdentityDecision({
      ...base,
      storedExternalId: ' 17841400000000000 ',
      fetchedExternalId: undefined,
    }), {
      ok: true,
      externalId: '17841400000000000',
      shouldPersist: false,
    });
  });

  it('fails closed when neither the row nor the fetch has a stable identity', () => {
    const decision = stableIdentityDecision({
      ...base,
      storedExternalId: null,
      fetchedExternalId: undefined,
    });

    assert.equal(decision.ok, false);
    if (decision.ok) return;
    assert.equal(decision.reason, 'invalid_source_identity');
    assert.match(decision.message, /resolve the account identity/i);
    assert.match(decision.message, /no observations were written/i);
  });

  it('normalizes and requires persistence for a newly resolved stable id', () => {
    assert.deepEqual(stableIdentityDecision({
      ...base,
      storedExternalId: null,
      fetchedExternalId: ' 17841400000000000 ',
    }), {
      ok: true,
      externalId: '17841400000000000',
      shouldPersist: true,
    });
  });

  it('canonicalizes a legacy whitespace-padded stored id before observations land', () => {
    assert.deepEqual(stableIdentityDecision({
      ...base,
      storedExternalId: ' 17841400000000000 ',
      fetchedExternalId: '17841400000000000',
    }), {
      ok: true,
      externalId: '17841400000000000',
      shouldPersist: true,
    });
  });

  it('accepts an exact stable-id match without another write', () => {
    assert.deepEqual(stableIdentityDecision({
      ...base,
      storedExternalId: '17841400000000000',
      fetchedExternalId: '17841400000000000',
    }), {
      ok: true,
      externalId: '17841400000000000',
      shouldPersist: false,
    });
  });

  it('fails closed when another pooled channel owns the fetched stable id', () => {
    const decision = stableIdentityDecision({
      ...base,
      storedExternalId: null,
      fetchedExternalId: '17841400000000000',
      conflictingOwner: {
        channelId: 'channel-other',
        handle: 'BostonGlobeNews',
        companyName: 'The Boston Globe',
      },
    });

    assert.equal(decision.ok, false);
    if (decision.ok) return;
    assert.equal(decision.reason, 'identity_claimed_elsewhere');
    assert.match(decision.message, /channel-other/);
    assert.match(decision.message, /histories were not merged/i);
    assert.match(decision.message, /no observations were written/i);
  });

  it('fails closed when a saved account resolves to a different stable id', () => {
    const decision = stableIdentityDecision({
      ...base,
      storedExternalId: 'old-account-id',
      fetchedExternalId: 'new-account-id',
    });

    assert.equal(decision.ok, false);
    if (decision.ok) return;
    assert.equal(decision.reason, 'stored_identity_changed');
    assert.match(decision.message, /possible handle reassignment/i);
    assert.match(decision.message, /no observations were written/i);
  });

  it('retains an Instagram id across vendor namespaces only with known-post proof', () => {
    assert.equal(canRetainStoredInstagramIdentity({
      platform: 'instagram',
      storedSource: 'ensembledata',
      fetchedSource: 'brightdata',
      storedHandle: '@BostonGlobe',
      fetchedHandle: 'bostonglobe',
      hasKnownPost: true,
    }), true);

    assert.equal(canRetainStoredInstagramIdentity({
      platform: 'instagram',
      storedSource: 'ensembledata',
      fetchedSource: 'brightdata',
      storedHandle: 'bostonglobe',
      fetchedHandle: 'bostonglobe',
      hasKnownPost: false,
    }), false, 'a matching mutable handle is not proof by itself');

    assert.equal(canRetainStoredInstagramIdentity({
      platform: 'instagram',
      storedSource: 'ensembledata',
      fetchedSource: 'brightdata',
      storedHandle: 'bostonglobe',
      fetchedHandle: 'bostonglobereassigned',
      hasKnownPost: true,
    }), false, 'known content does not excuse a resolved-handle mismatch');
  });

  it('does not relax identity checks for another platform or same-source changes', () => {
    assert.equal(canRetainStoredInstagramIdentity({
      platform: 'tiktok',
      storedSource: 'ensembledata',
      fetchedSource: 'brightdata',
      storedHandle: 'bostonglobe',
      fetchedHandle: 'bostonglobe',
      hasKnownPost: true,
    }), false);

    assert.equal(canRetainStoredInstagramIdentity({
      platform: 'instagram',
      storedSource: 'brightdata',
      fetchedSource: 'brightdata',
      storedHandle: 'bostonglobe',
      fetchedHandle: 'bostonglobe',
      hasKnownPost: true,
    }), false);
  });

  it('treats a profile with a blank platform id as an adapter contract failure', () => {
    const decision = stableIdentityDecision({
      ...base,
      storedExternalId: null,
      fetchedExternalId: '   ',
    });

    assert.equal(decision.ok, false);
    if (decision.ok) return;
    assert.equal(decision.reason, 'invalid_source_identity');
    assert.match(decision.message, /blank platform id/i);
  });

  it('saves only a validated empty continuation receipt before identity is available', () => {
    assert.equal(canDeferIdentityForEmptyContinuation({
      posts: [],
      audience: [],
      profile: undefined,
      cursor: {
        source: 'brightdata',
        pendingSnapshotId: 'sd_abc123',
        nextCursor: 'sd_abc123',
      },
      hasMore: true,
      exhaustive: false,
    }), true);

    assert.equal(canDeferIdentityForEmptyContinuation({
      posts: [],
      audience: [],
      profile: undefined,
      cursor: { pendingSnapshotId: 'sd_abc123' },
      hasMore: true,
      exhaustive: false,
    }), false, 'a vendor-specific id without the durable generic cursor is not enough');

    assert.equal(canDeferIdentityForEmptyContinuation({
      posts: [{ externalId: 'post-1' }] as never,
      audience: [],
      profile: undefined,
      cursor: { nextCursor: 'sd_abc123' },
      hasMore: true,
      exhaustive: false,
    }), false, 'identity must be verified before even one observation can land');
  });

  it('defers a bound Instagram graph id until the paid post rows can prove overlap', () => {
    const profile = {
      externalId: '17841400000000000',
      handle: 'bostonglobe',
      meta: { source: 'brightdata' },
    };
    assert.equal(canDeferBoundInstagramIdentity({
      posts: [],
      profile,
      cursor: {
        source: 'brightdata',
        pendingSnapshotId: 'sd_posts',
        nextCursor: 'sd_posts',
        pendingProfileExternalId: profile.externalId,
        pendingProfileHandle: profile.handle,
        pendingProfileSource: 'brightdata',
      },
      hasMore: true,
      exhaustive: false,
    }), true);

    assert.equal(canDeferBoundInstagramIdentity({
      posts: [],
      profile,
      cursor: {
        source: 'brightdata',
        pendingSnapshotId: 'sd_posts',
        nextCursor: 'sd_posts',
        pendingProfileExternalId: 'different-profile',
        pendingProfileHandle: profile.handle,
        pendingProfileSource: 'brightdata',
      },
      hasMore: true,
      exhaustive: false,
    }), false, 'the durable receipt must bind the exact unverified profile');
  });

  it('withholds an unreconciled short Instagram fallback instead of failing the queue', () => {
    assert.equal(canWithholdUnverifiedInstagramObservations({
      platform: 'instagram',
      storedHandle: '@nbc10boston',
      fetched: {
        profile: {
          externalId: '17841402576175047',
          handle: 'nbc10boston',
          meta: { source: 'brightdata' },
        },
        hasMore: false,
        exhaustive: false,
      },
    }), true);

    assert.equal(canWithholdUnverifiedInstagramObservations({
      platform: 'instagram',
      storedHandle: 'nbc10boston',
      fetched: {
        profile: {
          externalId: 'different-id',
          handle: 'reassignedhandle',
          meta: { source: 'brightdata' },
        },
        hasMore: false,
        exhaustive: false,
      },
    }), false, 'a different resolved handle remains a hard identity conflict');
  });

  it('fails closed when a paid Bright Data continuation receipt cannot be saved', () => {
    assert.equal(cursorPersistenceFailureOutcome({
      hasMore: true,
      cursor: {
        source: 'brightdata',
        brightDataStage: 'instagram-posts',
        pendingSnapshotId: 'sd_paid_pending',
      },
    }), 'permanent_failure');
  });

  it('keeps ordinary cursor persistence failures retryable', () => {
    assert.equal(cursorPersistenceFailureOutcome({
      hasMore: true,
      cursor: { source: 'brightdata' },
    }), 'retryable_operational_failure', 'an incomplete paid marker is not treated as a receipt');

    assert.equal(cursorPersistenceFailureOutcome({
      hasMore: true,
      cursor: {
        source: 'bluesky',
        pendingSnapshotId: 'cursor-page-2',
      },
    }), 'retryable_operational_failure', 'non-paid continuations retain normal recovery');

    assert.equal(cursorPersistenceFailureOutcome({
      hasMore: false,
      cursor: {
        source: 'brightdata',
        pendingSnapshotId: 'sd_finished',
      },
    }), 'retryable_operational_failure', 'completed windows cannot hold a paid continuation');
  });
});
