import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  durableFacebookCreativeUrl,
  fetchPagePosts,
  mapFacebookVendorPost,
} from './facebook-brightdata';

const RANGE = {
  since: new Date('2026-07-01T00:00:00Z'),
  until: new Date('2026-07-31T23:59:59Z'),
};

function row(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    post_id: 'facebook-post-1',
    date_posted: '2026-07-17T19:57:00Z',
    url: 'https://www.facebook.com/example/posts/1',
    content: 'The Celtics bridge story',
    post_type: 'Photo',
    header_image: 'https://cdn.example/page-cover.jpg',
    post_image: 'https://cdn.example/story-creative.jpg',
    attachments: [{
      id: 'attachment-1',
      url: 'https://cdn.example/story-creative.jpg',
      type: 'Photo',
      video_url: null,
      thumbnail_url: null,
    }],
    likes: 100,
    num_comments: 20,
    num_shares: 5,
    ...overrides,
  };
}

describe('Bright Data Facebook post creative', () => {
  it('uses the post attachment instead of the page cover image', () => {
    const post = mapFacebookVendorPost(row(), RANGE);
    assert.equal(post?.type, 'photo');
    assert.equal(post?.thumbnailUrl, 'https://cdn.example/story-creative.jpg');
    assert.equal(post?.mediaUrl, 'https://cdn.example/story-creative.jpg');
    assert.notEqual(post?.thumbnailUrl, 'https://cdn.example/page-cover.jpg');
  });

  it('falls back to post_image but never to header_image', () => {
    const post = mapFacebookVendorPost(row({ attachments: [] }), RANGE);
    assert.equal(post?.thumbnailUrl, 'https://cdn.example/story-creative.jpg');

    const withoutCreative = mapFacebookVendorPost(row({
      attachments: [],
      post_image: null,
      post_external_image: null,
    }), RANGE);
    assert.equal(withoutCreative?.thumbnailUrl, null);
  });

  it('classifies multiple attachments as a carousel and video URLs as media', () => {
    const carousel = mapFacebookVendorPost(row({
      attachments: [
        { type: 'Photo', url: 'https://cdn.example/one.jpg' },
        { type: 'Photo', url: 'https://cdn.example/two.jpg' },
      ],
    }), RANGE);
    assert.equal(carousel?.type, 'carousel');

    const video = mapFacebookVendorPost(row({
      post_type: 'Video',
      attachments: [{
        type: 'Video',
        video_url: 'https://cdn.example/video.mp4',
        thumbnail_url: 'https://cdn.example/video.jpg',
      }],
    }), RANGE);
    assert.equal(video?.type, 'video');
    assert.equal(video?.mediaUrl, 'https://cdn.example/video.mp4');
    assert.equal(video?.thumbnailUrl, 'https://cdn.example/video.jpg');
  });

  it('unwraps durable publisher images from Facebook external-image proxies only', () => {
    const proxy = 'https://external-bos5-1.xx.fbcdn.net/safe_image.php'
      + '?url=https%3A%2F%2Fcdn.bostonglobe.com%2Fstory.jpg%3Fwidth%3D1200';
    assert.equal(
      durableFacebookCreativeUrl(proxy),
      'https://cdn.bostonglobe.com/story.jpg?width=1200',
    );
    assert.equal(
      durableFacebookCreativeUrl('https://scontent-bos5-1.xx.fbcdn.net/native.jpg'),
      'https://scontent-bos5-1.xx.fbcdn.net/native.jpg',
    );
  });

  it('does not certify a window when the cursorless vendor cap is filled', async (t) => {
    t.mock.method(globalThis, 'fetch', async () => new Response(JSON.stringify([
      row({ post_id: 'facebook-post-1' }),
      row({ post_id: 'facebook-post-2' }),
    ]), { status: 200, headers: { 'content-type': 'application/json' } }));

    const result = await fetchPagePosts('example', 'test-key', { ...RANGE, limit: 2 });

    assert.equal(result.posts.length, 2);
    assert.equal(result.exhaustive, false);
    assert.match(result.incompleteReason ?? '', /without a continuation cursor/);
  });
});
