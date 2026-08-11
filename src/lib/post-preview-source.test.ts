import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, it } from 'node:test';
import { PLATFORMS } from './types';
import {
  allowedInstagramRedirect,
  allowedTikTokRedirect,
  canonicalInstagramPermalink,
  instagramOgImageUrl,
  isAllowedInstagramMediaUrl,
  isAllowedTikTokMediaUrl,
  isAllowedTikTokPermalink,
  sanitizePooledPostRaw,
  storedInstagramPreviewCandidates,
  storedThreadsPreviewCandidates,
  storedTikTokPosterCandidates,
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

  it('accepts only canonical public Instagram post permalinks', () => {
    assert.equal(
      canonicalInstagramPermalink('https://instagram.com/reel/DaZTyfjK4Kr/?igsh=tracking'),
      'https://www.instagram.com/reel/DaZTyfjK4Kr/',
    );
    assert.equal(
      canonicalInstagramPermalink('https://www.instagram.com/p/Dbqkmp-k1D9/'),
      'https://www.instagram.com/p/Dbqkmp-k1D9/',
    );
    assert.equal(canonicalInstagramPermalink('https://www.instagram.com/nesn/'), null);
    assert.equal(canonicalInstagramPermalink('https://www.instagram.com.evil.test/p/example/'), null);
  });

  it('extracts only an allowlisted Open Graph poster from public post HTML', () => {
    const poster = 'https://scontent-bos5-1.cdninstagram.com/fresh.jpg?x=1&amp;y=2';
    assert.equal(
      instagramOgImageUrl(`<meta content="${poster}" property="og:image" />`),
      'https://scontent-bos5-1.cdninstagram.com/fresh.jpg?x=1&y=2',
    );
    assert.equal(
      instagramOgImageUrl('<meta property="og:image" content="https://example.com/not-safe.jpg">'),
      null,
    );
    assert.equal(instagramOgImageUrl('<meta property="og:title" content="No poster">'), null);
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

  it('persists only validated preview candidates from every supported legacy shape', () => {
    const topPoster = 'https://top.fna.fbcdn.net/top.jpg';
    const nodePoster = 'https://node.cdninstagram.com/node.jpg';
    const mediaPoster = 'https://media.fna.fbcdn.net/media.jpg';
    const sidecarPoster = 'https://sidecar.cdninstagram.com/sidecar.jpg';
    const displayResource = 'https://display.fna.fbcdn.net/display.jpg';
    const thumbnailResource = 'https://thumb.cdninstagram.com/thumb.jpg';
    const topVideo = 'https://video.fna.fbcdn.net/top.mp4';
    const rendition = 'https://rendition.cdninstagram.com/rendition.mp4';

    const sanitized = sanitizePooledPostRaw('instagram', {
      preview: {
        posterUrls: [topPoster, 'https://example.com/not-allowed.jpg'],
        videoUrls: [topVideo],
        privateNote: 'drop me',
      },
      display_uri: topPoster,
      node: {
        thumbnail_url: nodePoster,
        display_resources: [{ src: displayResource, width: 1080 }],
        owner: { email: 'drop@example.com' },
      },
      media: {
        image_versions2: { candidates: [{ url: mediaPoster, width: 640 }] },
        video_versions: [{ url: rendition, type: 101 }],
      },
      edge_sidecar_to_children: {
        edges: [{ node: {
          image_url: sidecarPoster,
          thumbnail_resources: [{ src: thumbnailResource, height: 640 }],
        } }],
      },
      caption: 'drop me',
      user: { phone_number: 'drop me' },
    });

    assert.deepEqual(sanitized, {
      preview: {
        posterUrls: [
          topPoster,
          nodePoster,
          displayResource,
          mediaPoster,
          sidecarPoster,
          thumbnailResource,
        ],
        videoUrls: [topVideo, rendition],
      },
    });
    assert.deepEqual(sanitizePooledPostRaw('instagram', sanitized), sanitized);
  });

  it('default-denies every platform without an explicit preview policy', () => {
    const arbitrary = {
      author: { email: 'private@example.com' },
      access_token: 'must-not-survive',
      image_url: 'https://example.com/image.jpg',
    };

    for (const platform of PLATFORMS) {
      if (platform === 'instagram' || platform === 'threads') continue;
      assert.equal(sanitizePooledPostRaw(platform, arbitrary), null, platform);
    }
    assert.equal(sanitizePooledPostRaw('instagram', arbitrary), null);
    assert.equal(sanitizePooledPostRaw('threads', arbitrary), null);
    assert.equal(sanitizePooledPostRaw('instagram', null), null);
  });

  it('keeps only validated Threads image and video candidates', () => {
    const poster = 'https://scontent-lga3-2.cdninstagram.com/threads-cover.jpg';
    const video = 'https://video.fna.fbcdn.net/threads-video.mp4';
    const sanitized = sanitizePooledPostRaw('threads', {
      images: [poster, 'https://example.com/drop.jpg'],
      videos: [video],
      post_content: 'not persisted',
    });

    assert.deepEqual(sanitized, {
      preview: { posterUrls: [poster], videoUrls: [video] },
    });
    const post = {
      platform: 'threads' as const,
      thumbnailUrl: poster,
      mediaUrl: video,
      raw: sanitized,
    };
    assert.deepEqual(storedThreadsPreviewCandidates(post, 'poster'), [poster, video]);
    assert.deepEqual(storedThreadsPreviewCandidates(post, 'video'), [video]);
  });

  it('bounds stored candidates to the proxy limits without changing their order', () => {
    const posters = Array.from(
      { length: 20 },
      (_, index) => `https://poster-${index}.fna.fbcdn.net/image.jpg`,
    );
    const videos = Array.from(
      { length: 10 },
      (_, index) => `https://video-${index}.cdninstagram.com/video.mp4`,
    );
    const sanitized = sanitizePooledPostRaw('instagram', {
      preview: { posterUrls: posters, videoUrls: videos },
    });

    assert.deepEqual(sanitized, {
      preview: { posterUrls: posters.slice(0, 12), videoUrls: videos.slice(0, 6) },
    });
  });

  it('applies the sanitizer at the shared pooled post write', () => {
    const runner = readFileSync(resolve(process.cwd(), 'src/lib/adapters/runner.ts'), 'utf8');
    assert.match(runner, /raw:\s*sanitizePooledPostRaw\(platform, post\.raw\)/);
    assert.doesNotMatch(runner, /raw:\s*post\.raw\s*\?\?/);
  });
});

describe('TikTok preview source safety', () => {
  const poster = 'https://p16-common-sign.tiktokcdn-us.com/path/cover.jpeg?x-expires=1';

  it('accepts regional TikTok CDN hosts without accepting lookalikes', () => {
    assert.equal(isAllowedTikTokMediaUrl(poster), true);
    assert.equal(isAllowedTikTokMediaUrl('https://p19-sign.tiktokcdn.com/image.jpeg'), true);
    assert.equal(isAllowedTikTokMediaUrl('https://p16.tiktokcdn-eu.com/image.jpeg'), true);
    assert.equal(isAllowedTikTokMediaUrl('http://p16.tiktokcdn-us.com/image.jpeg'), false);
    assert.equal(isAllowedTikTokMediaUrl('https://tiktokcdn-us.com.evil.example/image.jpeg'), false);
    assert.equal(isAllowedTikTokMediaUrl('https://user@p16.tiktokcdn-us.com/image.jpeg'), false);
  });

  it('allows only canonical public video permalinks for oEmbed resolution', () => {
    assert.equal(
      isAllowedTikTokPermalink('https://www.tiktok.com/@bostonglobe/video/7666210267478379790'),
      true,
    );
    assert.equal(isAllowedTikTokPermalink('https://www.tiktok.com/@bostonglobe'), false);
    assert.equal(isAllowedTikTokPermalink('https://vm.tiktok.com/example'), false);
    assert.equal(isAllowedTikTokPermalink('https://www.tiktok.com.evil.example/@x/video/123'), false);
  });

  it('validates redirects and exposes only an allowlisted stored poster', () => {
    assert.equal(
      allowedTikTokRedirect(poster, '/fresh.jpeg'),
      'https://p16-common-sign.tiktokcdn-us.com/fresh.jpeg',
    );
    assert.equal(allowedTikTokRedirect(poster, 'https://example.com/image.jpeg'), null);
    assert.deepEqual(storedTikTokPosterCandidates({
      platform: 'tiktok',
      thumbnailUrl: poster,
      mediaUrl: null,
      raw: null,
    }), [poster]);
    assert.deepEqual(storedTikTokPosterCandidates({
      platform: 'instagram',
      thumbnailUrl: poster,
      mediaUrl: null,
      raw: null,
    }), []);
  });
});
