import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { instagramPlays } from './instagram-brightdata';

describe('instagramPlays', () => {
  it('reads plays when the vendor sends video_view_count: 0 beside them', () => {
    assert.equal(instagramPlays({ video_view_count: 0, video_play_count: 480000 }), 480000);
  });
  it('accepts the reels dataset field names and numeric strings', () => {
    assert.equal(instagramPlays({ views: '12,345', video_play_count: null }), 12345);
  });
  it('stays 0 for photos with no play fields', () => {
    assert.equal(instagramPlays({ video_view_count: null, video_play_count: null }), 0);
    assert.equal(instagramPlays({}), 0);
  });
});
