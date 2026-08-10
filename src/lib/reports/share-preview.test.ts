import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { sharedReportContainsPost } from './share-preview';

const computed = {
  version: 1,
  focus: {},
  brands: [],
  topPosts: [{ id: 'market-post' }],
  bgmTopPosts: [{ id: 'bgm-post' }],
};

describe('shared report preview authorization', () => {
  it('allows only posts embedded in the saved report snapshot', () => {
    assert.equal(sharedReportContainsPost(computed, 'market-post'), true);
    assert.equal(sharedReportContainsPost(computed, 'bgm-post'), true);
    assert.equal(sharedReportContainsPost(computed, 'another-post'), false);
  });

  it('fails closed for malformed or obsolete computed report data', () => {
    assert.equal(sharedReportContainsPost(null, 'market-post'), false);
    assert.equal(sharedReportContainsPost({ version: 0, focus: {}, brands: [] }, 'market-post'), false);
  });
});
