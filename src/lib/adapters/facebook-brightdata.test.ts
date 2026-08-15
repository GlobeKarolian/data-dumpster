import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  durableFacebookCreativeUrl,
  fetchFacebookProfile,
  fetchPagePosts,
  mapFacebookVendorPost,
} from './facebook-brightdata';
import { collectionOutcomeForFetch } from './runner';

const RANGE = {
  since: new Date('2026-07-01T00:00:00Z'),
  until: new Date('2026-07-31T23:59:59Z'),
};

function row(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    delegate_page_id: 'facebook-page-1',
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
  it('resolves a stable Facebook Page identity through the Pages and Profiles dataset', async (t) => {
    let requestedUrl = '';
    let requestedBody: unknown;
    t.mock.method(globalThis, 'fetch', async (
      input: RequestInfo | URL,
      init?: RequestInit,
    ) => {
      requestedUrl = String(input);
      requestedBody = JSON.parse(String(init?.body));
      return new Response(JSON.stringify([{
        id: '100070055152736',
        url: 'https://www.facebook.com/p/JD-Vance-100070055152736/',
        page_name: 'JD Vance',
        entity_type: 'PAGE',
        followers: 250000,
        logo: 'https://cdn.example/jd.jpg',
      }]), { status: 200, headers: { 'content-type': 'application/json' } });
    });

    const result = await fetchFacebookProfile(
      'https://www.facebook.com/p/JD-Vance-100070055152736/',
      'test-key',
    );

    assert.equal(result.profile.externalId, '100070055152736');
    assert.equal(result.profile.displayName, 'JD Vance');
    assert.equal(result.profile.avatarUrl, 'https://cdn.example/jd.jpg');
    assert.equal(result.profile.meta?.profileType, 'PAGE');
    assert.equal(result.audience?.followers, 250000);
    assert.equal(new URL(requestedUrl).searchParams.get('dataset_id'), 'gd_mf124a0511bauquyow');
    assert.deepEqual(requestedBody, [{
      url: 'https://www.facebook.com/p/JD-Vance-100070055152736/',
    }]);
  });

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

  it('does not treat a short completed snapshot as proof of historical exhaustion', async (t) => {
    t.mock.method(globalThis, 'fetch', async () => new Response(JSON.stringify([
      row({ post_id: 'facebook-post-1' }),
    ]), { status: 200, headers: { 'content-type': 'application/json' } }));

    const result = await fetchPagePosts('example', 'test-key', { ...RANGE, limit: 2 });

    assert.equal(result.posts.length, 1);
    assert.equal(result.exhaustive, false);
    assert.match(result.incompleteReason ?? '', /no terminal cursor or completeness marker/i);
  });

  it('rejects rows that do not identify a stable Facebook Page', async (t) => {
    t.mock.method(globalThis, 'fetch', async () => new Response(JSON.stringify([
      row({ delegate_page_id: null, page_id: null }),
    ]), { status: 200, headers: { 'content-type': 'application/json' } }));

    await assert.rejects(
      fetchPagePosts('example', 'test-key', { ...RANGE, limit: 2 }),
      /without a stable Page id.*No observations were accepted/i,
    );
  });

  it('keeps an existing Page identity when the vendor explicitly reports no posts in-range', async (t) => {
    t.mock.method(globalThis, 'fetch', async () => new Response(JSON.stringify([{
      error: 'Posts for the specified period were not found',
      error_code: 'dead_page',
      input: {
        url: 'https://www.facebook.com/example',
        num_of_posts: 200,
        start_date: '07-01-2026',
        end_date: '07-31-2026',
      },
    }]), { status: 200, headers: { 'content-type': 'application/json' } }));

    const result = await fetchPagePosts('example', 'test-key', { ...RANGE, limit: 200 });

    assert.equal(result.profile, undefined);
    assert.equal(result.posts.length, 0);
    assert.equal(result.exhaustive, false);
    assert.match(result.incompleteReason ?? '', /no Facebook posts.*source limited/i);
  });

  it('does not generalize other vendor error rows into an empty period', async (t) => {
    t.mock.method(globalThis, 'fetch', async () => new Response(JSON.stringify([{
      error: 'The requested Page is private',
      error_code: 'dead_page',
    }]), { status: 200, headers: { 'content-type': 'application/json' } }));

    await assert.rejects(
      fetchPagePosts('example', 'test-key', { ...RANGE, limit: 200 }),
      /could not collect the Facebook Page example.*requested Page is private/i,
    );
  });
});

describe('resumable snapshots', () => {
  it('raises an unfinished snapshot as retryable, carrying its id', async () => {
  const { PendingSnapshotError } = await import('@/lib/vendors/brightdata');
  const err = new PendingSnapshotError('facebook', 'sd_abc123');
  assert.equal(err.snapshotId, 'sd_abc123');
  assert.equal(err.opts.retryable, true,
    'the job is still running on the vendor side, so giving up permanently forfeits the spend');
    assert.match(err.message, /sd_abc123/);
  });

  it('settles a cursorless filled cap as terminal-incomplete', () => {
    assert.equal(collectionOutcomeForFetch({
      hasMore: false,
      exhaustive: false,
    }), 'terminal_source_limitation');
  });
});
