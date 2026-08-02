import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  allowedInstagramRedirect,
  isAllowedInstagramMediaUrl,
  storedInstagramPreviewCandidates,
} from './post-preview-source';

describe('Instagram preview source safety', () => {
  it('accepts only HTTPS Meta CDN subdomains', () => {
    assert.equal(
      isAllowedInstagramMediaUrl('https://instagram.fbos1-1.fna.fbcdn.net/image.jpg?sig=1'),
      true,
    );
    assert.equal(
      isAllowedInstagramMediaUrl('https://scontent-lga3-2.cdninstagram.com/video.mp4'),
      true,
    );
    assert.equal(isAllowedInstagramMediaUrl('http://scontent-lga3-2.cdninstagram.com/x'), false);
    assert.equal(isAllowedInstagramMediaUrl('https://fbcdn.net/x'), false);
    assert.equal(isAllowedInstagramMediaUrl('https://fbcdn.net.evil.example/x'), false);
    assert.equal(isAllowedInstagramMediaUrl('https://user@x.fbcdn.net/x'), false);
    assert.equal(isAllowedInstagramMediaUrl('https://x.fbcdn.net:444/x'), false);
  });

  it('validates absolute and relative redirects against the same allowlist', () => {
    const current = 'https://instagram.fbos1-1.fna.fbcdn.net/a/image.jpg';
    assert.equal(
      allowedInstagramRedirect(current, '/b/image.jpg'),
      'https://instagram.fbos1-1.fna.fbcdn.net/b/image.jpg',
    );
    assert.equal(
      allowedInstagramRedirect(current, 'https://scontent-lga3-2.cdninstagram.com/image.jpg'),
      'https://scontent-lga3-2.cdninstagram.com/image.jpg',
    );
    assert.equal(allowedInstagramRedirect(current, 'https://example.com/image.jpg'), null);
    assert.equal(allowedInstagramRedirect(current, '//fbcdn.net.evil.example/image.jpg'), null);
  });

  it('extracts and deduplicates known poster and video fields only', () => {
    const poster = 'https://instagram.fbos1-1.fna.fbcdn.net/poster.jpg';
    const video = 'https://scontent-lga3-2.cdninstagram.com/reel.mp4';
    const post = {
      platform: 'instagram' as const,
      thumbnailUrl: poster,
      mediaUrl: null,
      raw: {
        display_uri: poster,
        permalink: 'https://www.instagram.com/reel/example/',
        image_versions2: {
          candidates: [{ url: 'https://instagram.fbos1-1.fna.fbcdn.net/alternate.jpg' }],
        },
        video_versions: [{ url: video }],
      },
    };

    assert.deepEqual(storedInstagramPreviewCandidates(post, 'poster'), [
      poster,
      'https://instagram.fbos1-1.fna.fbcdn.net/alternate.jpg',
    ]);
    assert.deepEqual(storedInstagramPreviewCandidates(post, 'video'), [video]);
    assert.deepEqual(
      storedInstagramPreviewCandidates({ ...post, platform: 'facebook' }, 'poster'),
      [],
    );
  });
});

