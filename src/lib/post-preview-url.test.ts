import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { postPosterUrl, postVideoUrl } from './post-preview-url';

describe('post preview URLs', () => {
  const instagramReel = {
    id: '4c6335ea-640d-44f2-884f-7c26b6f88ed1',
    platform: 'instagram' as const,
    type: 'reel' as const,
    permalink: 'https://www.instagram.com/reel/DaZTyfjK4Kr/',
    thumbnailUrl: 'https://instagram.example/expired.jpg',
  };

  it('routes Instagram posters through the authenticated same-origin proxy', () => {
    assert.equal(
      postPosterUrl(instagramReel),
      '/api/posts/4c6335ea-640d-44f2-884f-7c26b6f88ed1/preview',
    );
  });

  it('can recover an Instagram poster from its permalink when no CDN URL was stored', () => {
    assert.equal(
      postPosterUrl({ ...instagramReel, thumbnailUrl: null }),
      '/api/posts/4c6335ea-640d-44f2-884f-7c26b6f88ed1/preview',
    );
  });

  it('keeps non-Instagram thumbnails direct and leaves truly empty posts blank', () => {
    assert.equal(postPosterUrl({
      ...instagramReel,
      platform: 'facebook',
      thumbnailUrl: 'https://facebook.example/post.jpg',
    }), 'https://facebook.example/post.jpg');
    assert.equal(postPosterUrl({
      ...instagramReel,
      permalink: null,
      thumbnailUrl: null,
    }), null);
  });

  it('uses the video proxy for Instagram motion posts and preserves other media URLs', () => {
    assert.equal(
      postVideoUrl(instagramReel, null),
      '/api/posts/4c6335ea-640d-44f2-884f-7c26b6f88ed1/preview?kind=video',
    );
    assert.equal(
      postVideoUrl({ ...instagramReel, platform: 'youtube', type: 'video' }, 'https://youtu.be/x'),
      'https://youtu.be/x',
    );
    assert.equal(postVideoUrl({ ...instagramReel, type: 'photo' }, null), null);
  });
});
