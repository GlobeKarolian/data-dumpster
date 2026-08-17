import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  legacyPublicSourceCursorState,
  mergedPublicSourceCursor,
  publicSourceCursorStateForAttempt,
  publicSourceResponseMatchesAttempt,
  reconcilePublicSourceCursorState,
  selectedPublicSourceKey,
} from './runner';

describe('public source-specific runner state', () => {
  it('selects the same deterministic public source as the adapter policy', () => {
    assert.equal(selectedPublicSourceKey('instagram', {
      brightDataApiKey: 'bright',
      ensembleDataToken: 'ensemble',
    }), 'brightdata');
    // X mirrors twitterSourceOrder: the official API leads whenever the
    // deployment Bearer is present; vendors are the no-Bearer fallback.
    assert.equal(selectedPublicSourceKey('twitter', {
      bearerToken: 'x-app-bearer',
      brightDataApiKey: 'bright',
      ensembleDataToken: 'ensemble',
    }), 'x-api-v2');
    assert.equal(selectedPublicSourceKey('twitter', {
      brightDataApiKey: 'bright',
      ensembleDataToken: 'ensemble',
    }), 'brightdata');
    assert.equal(selectedPublicSourceKey('twitter', {
      ensembleDataToken: 'ensemble',
    }), 'ensembledata');
    assert.equal(selectedPublicSourceKey('threads', {
      ensembleDataToken: 'ensemble',
    }), 'ensembledata');
    assert.equal(selectedPublicSourceKey('youtube', { apiKey: 'youtube' }), 'youtube-data-api-v3');
    assert.equal(selectedPublicSourceKey('bluesky', {}), 'bluesky-public-appview');
    assert.equal(selectedPublicSourceKey('linkedin', {
      brightDataApiKey: 'bright',
    }), 'brightdata');
    assert.equal(selectedPublicSourceKey('truth_social', {
      apifyApiToken: 'apify',
    }), 'apify-truth-social');
    assert.equal(selectedPublicSourceKey('truth_social', {}), undefined);
  });

  it('does not seed a Bright Data cutover from an EnsembleData cursor or watermark', () => {
    const previousSuccess = new Date('2026-08-01T12:00:00.000Z');
    const legacyCursor = {
      source: 'ensembledata',
      nextCursor: 'ensemble-page-2',
      windowSince: '2026-07-01T00:00:00.000Z',
      windowUntil: '2026-08-01T00:00:00.000Z',
    };

    assert.deepEqual(legacyPublicSourceCursorState({
      platform: 'instagram',
      sourceKey: 'brightdata',
      cursor: legacyCursor,
      lastIngestedAt: previousSuccess,
    }), {
      sourceKey: 'brightdata',
      cursor: {},
      lastIngestedAt: null,
    });

    assert.deepEqual(legacyPublicSourceCursorState({
      platform: 'instagram',
      sourceKey: 'ensembledata',
      cursor: legacyCursor,
      lastIngestedAt: previousSuccess,
    }), {
      sourceKey: 'ensembledata',
      cursor: legacyCursor,
      lastIngestedAt: previousSuccess,
    });
  });

  it('keeps source-less compatibility only for single-source public platforms', () => {
    const legacyCursor = { nextPageToken: 'page-2', __isOwned: true };
    const previousSuccess = new Date('2026-08-02T03:00:00.000Z');

    assert.deepEqual(legacyPublicSourceCursorState({
      platform: 'youtube',
      sourceKey: 'youtube-data-api-v3',
      cursor: legacyCursor,
      lastIngestedAt: previousSuccess,
    }), {
      sourceKey: 'youtube-data-api-v3',
      cursor: { nextPageToken: 'page-2' },
      lastIngestedAt: previousSuccess,
    });

    assert.deepEqual(legacyPublicSourceCursorState({
      platform: 'reddit',
      sourceKey: 'ensembledata',
      cursor: { ...legacyCursor, source: 'owner-only-source' },
      lastIngestedAt: previousSuccess,
    }), {
      sourceKey: 'ensembledata',
      cursor: {},
      lastIngestedAt: null,
    });

    assert.deepEqual(legacyPublicSourceCursorState({
      platform: 'truth_social',
      sourceKey: 'apify-truth-social',
      cursor: { nextCursor: 'truth-page-2', __isOwned: true },
      lastIngestedAt: previousSuccess,
    }), {
      sourceKey: 'apify-truth-social',
      cursor: { nextCursor: 'truth-page-2' },
      lastIngestedAt: previousSuccess,
    });
  });

  it('merges and sanitizes only the selected source cursor', () => {
    assert.deepEqual(mergedPublicSourceCursor({
      source: 'brightdata',
      pendingSnapshotId: 'snapshot-1',
      __isOwned: true,
    }, {
      pendingSnapshotId: 'snapshot-2',
      nextCursor: 'snapshot-2',
      __temporary: 'drop-me',
    }), {
      source: 'brightdata',
      pendingSnapshotId: 'snapshot-2',
      nextCursor: 'snapshot-2',
    });
  });

  it('keeps a saved Bright Data receipt in charge when only EnsembleData is configured', () => {
    const ensembleState = {
      sourceKey: 'ensembledata' as const,
      cursor: { source: 'ensembledata', nextCursor: 'ensemble-page-2' },
      lastIngestedAt: null,
    };
    const brightDataState = {
      sourceKey: 'brightdata' as const,
      cursor: {
        source: 'brightdata',
        pendingSnapshotId: 'snapshot-paid',
        nextCursor: 'snapshot-paid',
      },
      lastIngestedAt: null,
    };

    assert.equal(
      publicSourceCursorStateForAttempt(ensembleState, brightDataState),
      brightDataState,
    );
  });

  it('fails the planned/actual source invariant instead of rebasing a response', () => {
    assert.equal(publicSourceResponseMatchesAttempt('brightdata', 'brightdata'), true);
    assert.equal(publicSourceResponseMatchesAttempt('ensembledata', 'brightdata'), false);
    assert.equal(publicSourceResponseMatchesAttempt('brightdata', 'ensembledata'), false);
  });

  it('lets the source row win except for a newly saved legacy paid receipt', () => {
    const stored = {
      sourceKey: 'brightdata' as const,
      cursor: { source: 'brightdata', lastRunAt: 'stored' },
      lastIngestedAt: new Date('2026-08-01T00:00:00.000Z'),
    };
    const ordinaryLegacy = {
      sourceKey: 'brightdata' as const,
      cursor: { source: 'brightdata', lastRunAt: 'legacy' },
      lastIngestedAt: new Date('2026-08-02T00:00:00.000Z'),
    };
    assert.equal(reconcilePublicSourceCursorState(stored, ordinaryLegacy), stored);

    const legacyReceipt = {
      ...ordinaryLegacy,
      cursor: {
        source: 'brightdata',
        pendingSnapshotId: 'snapshot-after-migration',
        nextCursor: 'snapshot-after-migration',
      },
    };
    assert.deepEqual(reconcilePublicSourceCursorState(stored, legacyReceipt), {
      ...legacyReceipt,
      lastIngestedAt: stored.lastIngestedAt,
    });
  });
});
