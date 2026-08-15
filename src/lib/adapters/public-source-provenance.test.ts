import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { FetchResult } from './types';
import {
  publicSourceKeyForFetch,
  unselectedPublicSourceKey,
} from './public-source-provenance';

function fetched(source?: string): Pick<FetchResult, 'cursor' | 'profile'> {
  return source ? { cursor: { source } } : {};
}

describe('pooled public-source provenance', () => {
  it('creates a truthful pre-request placeholder', () => {
    assert.equal(unselectedPublicSourceKey('instagram'), 'unselected:instagram');
  });

  it('records deterministic official public sources', () => {
    assert.equal(publicSourceKeyForFetch('youtube', fetched()), 'youtube-data-api-v3');
    assert.equal(publicSourceKeyForFetch('bluesky', fetched()), 'bluesky-public-appview');
  });

  it('records the vendor that actually produced a public response', () => {
    assert.equal(publicSourceKeyForFetch('instagram', fetched('ensembledata')), 'ensembledata');
    assert.equal(publicSourceKeyForFetch('instagram', fetched('brightdata')), 'brightdata');
    assert.equal(publicSourceKeyForFetch('threads', fetched('brightdata')), 'brightdata');
    assert.equal(publicSourceKeyForFetch('linkedin', fetched('brightdata')), 'brightdata');
    assert.equal(
      publicSourceKeyForFetch('truth_social', fetched('apify-truth-social')),
      'apify-truth-social',
    );
  });

  it('accepts profile provenance when a vendor response has no cursor', () => {
    assert.equal(publicSourceKeyForFetch('reddit', {
      profile: {
        externalId: 't2_account',
        handle: 'publisher',
        meta: { source: 'ensembledata' },
      },
    }), 'ensembledata');
  });

  it('fails closed when a vendor-backed response omits its source', () => {
    assert.throws(
      () => publicSourceKeyForFetch('tiktok', fetched()),
      /did not identify its vendor.*No pooled observations/i,
    );
  });

  it('rejects unexpected and owned-only sources', () => {
    assert.throws(
      () => publicSourceKeyForFetch('facebook', fetched('ensembledata')),
      /unsupported public source/i,
    );
    assert.throws(
      () => publicSourceKeyForFetch('twitter', fetched('x-api-v2')),
      /unsupported public source/i,
    );
    assert.throws(
      () => publicSourceKeyForFetch('linkedin', fetched('linkedin-api')),
      /unsupported public source/i,
    );
  });
});
