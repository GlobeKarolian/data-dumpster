import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { mapInstagramEnsembleReel } from './instagram-ensemble';

function observedReel(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    media: {
      pk: '3725980832566367793',
      id: '3725980832566367793_239602202',
      taken_at: 1_775_083_269,
      product_type: 'clips',
      code: 'DUMMYCODE',
      video_duration: 26.4,
      caption: {
        text: 'A newsroom Reel about #Boston from @bostonglobe',
      },
      display_uri: 'https://scontent.cdninstagram.com/reel-display.jpg?oe=6A000000',
      image_versions2: {
        candidates: [{
          url: 'https://scontent.cdninstagram.com/reel-candidate.jpg?oe=6A000000',
          width: 720,
          height: 900,
        }],
      },
      video_versions: [{
        id: '17906698179326930',
        url: 'https://scontent.cdninstagram.com/reel.mp4?oe=6A000000',
        type: 101,
        width: 720,
        height: 900,
        fallback: null,
        bandwidth: 1_603_371,
        url_expiration_timestamp_us: null,
      }],
      like_count: 120,
      comment_count: 8,
      reshare_count: 3,
      play_count: 4_200,
      ...overrides,
    },
  };
}

describe('EnsembleData Instagram Reel media', () => {
  it('maps the observed playable rendition and preferred poster', () => {
    const post = mapInstagramEnsembleReel(observedReel());

    assert.equal(post?.type, 'reel');
    assert.equal(post?.mediaUrl, 'https://scontent.cdninstagram.com/reel.mp4?oe=6A000000');
    assert.equal(
      post?.thumbnailUrl,
      'https://scontent.cdninstagram.com/reel-display.jpg?oe=6A000000',
    );
    assert.equal(post?.views, 4_200);
    assert.equal(post?.durationSec, 26);
  });

  it('falls back to the first image_versions2 poster candidate', () => {
    const post = mapInstagramEnsembleReel(observedReel({ display_uri: null }));

    assert.equal(
      post?.thumbnailUrl,
      'https://scontent.cdninstagram.com/reel-candidate.jpg?oe=6A000000',
    );
  });
});
