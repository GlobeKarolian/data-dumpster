import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  fetchLinkedInCompanyPosts,
  fetchLinkedInCompanyProfile,
  LINKEDIN_BRIGHTDATA_METRIC_AVAILABILITY,
  linkedInCompanyUrl,
  mapLinkedInCompanyPost,
  mapLinkedInCompanyProfile,
} from './linkedin-brightdata';

const RANGE = {
  since: new Date('2026-07-20T00:00:00.000Z'),
  until: new Date('2026-07-27T23:59:59.999Z'),
};

function postRow(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'urn:li:activity:123456789',
    url: 'https://www.linkedin.com/posts/bostonglobemedia_example-activity-123456789',
    user_id: '6531',
    use_url: 'https://www.linkedin.com/company/bostonglobemedia',
    user_name: 'Boston Globe Media',
    user_followers: 12_345,
    date_posted: '2026-07-24T14:30:00.000Z',
    post_text: 'A newsroom update for @reporter. #LocalNews https://example.com/story',
    hashtags: ['#LocalNews', 'Journalism'],
    embedded_links: [],
    images: ['https://cdn.example.com/photo.jpg'],
    videos: [],
    num_likes: 125,
    num_comments: 17,
    post_type: 'image',
    repost: null,
    video_duration: null,
    video_thumbnail: null,
    external_link_data: null,
    document_cover_image: null,
    ...overrides,
  };
}

describe('Bright Data LinkedIn company profile mapping', () => {
  it('requires the stable company_id and does not retain arbitrary vendor data', () => {
    const mapped = mapLinkedInCompanyProfile({
      company_id: '6531',
      id: 'bostonglobemedia',
      name: 'Boston Globe Media',
      followers: 12_345,
      url: 'https://www.linkedin.com/company/bostonglobemedia',
      logo: 'https://cdn.example.com/logo.png',
      updates: [{ text: 'must not be retained' }],
      internal_vendor_field: 'must not be retained',
    }, 'bostonglobemedia', new Date('2026-08-04T15:00:00.000Z'));

    assert.deepEqual(mapped, {
      profile: {
        externalId: '6531',
        handle: 'bostonglobemedia',
        displayName: 'Boston Globe Media',
        avatarUrl: 'https://cdn.example.com/logo.png',
        profileUrl: 'https://www.linkedin.com/company/bostonglobemedia',
        followers: 12_345,
        meta: { source: 'brightdata' },
      },
      audience: {
        day: '2026-08-04',
        followers: 12_345,
        extra: {},
      },
    });
    assert.equal('raw' in (mapped?.profile ?? {}), false);
  });

  it('preserves an observed zero follower stock but omits a missing stock', () => {
    const measuredZero = mapLinkedInCompanyProfile({
      company_id: '6531',
      id: 'bostonglobemedia',
      followers: 0,
    }, 'bostonglobemedia', new Date('2026-08-04T15:00:00.000Z'));
    assert.equal(measuredZero?.profile.followers, 0);
    assert.equal(measuredZero?.audience?.followers, 0);

    const missing = mapLinkedInCompanyProfile({
      company_id: '6531',
      id: 'bostonglobemedia',
    }, 'bostonglobemedia');
    assert.equal(missing?.profile.followers, undefined);
    assert.equal(missing?.audience, undefined);
  });

  it('never substitutes the mutable vanity id for a missing company_id', () => {
    assert.equal(mapLinkedInCompanyProfile({
      id: 'bostonglobemedia',
      followers: 12_345,
    }, 'bostonglobemedia'), undefined);
  });

  it('canonicalizes LinkedIn company, showcase, and school URLs', () => {
    assert.equal(
      linkedInCompanyUrl('@BostonGlobeMedia'),
      'https://www.linkedin.com/company/bostonglobemedia',
    );
    assert.equal(
      linkedInCompanyUrl('https://ca.linkedin.com/showcase/Boston-Globe-Today/?trk=public'),
      'https://www.linkedin.com/showcase/boston-globe-today',
    );
    assert.equal(
      linkedInCompanyUrl('https://www.linkedin.com/school/Harvard-University/'),
      'https://www.linkedin.com/school/harvard-university',
    );
    assert.throws(() => linkedInCompanyUrl('https://example.com/company/boston-globe'));
  });
});

describe('Bright Data LinkedIn company-post mapping', () => {
  it('maps only observed counters and exposes unavailable metric semantics', () => {
    const mapped = mapLinkedInCompanyPost(postRow(), {
      ...RANGE,
      expectedCompanyHandle: 'bostonglobemedia',
    });

    assert.equal(mapped?.externalId, 'urn:li:activity:123456789');
    assert.equal(mapped?.type, 'photo');
    assert.equal(mapped?.mediaUrl, 'https://cdn.example.com/photo.jpg');
    assert.equal(mapped?.thumbnailUrl, 'https://cdn.example.com/photo.jpg');
    assert.deepEqual(mapped?.hashtags, ['localnews', 'journalism']);
    assert.deepEqual(mapped?.mentions, ['reporter']);
    assert.deepEqual(mapped?.urls, ['https://example.com/story']);
    assert.equal(mapped?.applause, 125);
    assert.equal(mapped?.conversation, 17);
    assert.equal(mapped?.amplification, 0);
    assert.equal(mapped?.saves, 0);
    assert.equal(mapped?.views, 0);
    assert.equal('raw' in (mapped ?? {}), false);
    assert.deepEqual(LINKEDIN_BRIGHTDATA_METRIC_AVAILABILITY, {
      applause: true,
      conversation: true,
      amplification: false,
      saves: false,
      views: false,
    });
  });

  it('accepts measured zero likes/comments and rejects either missing counter', () => {
    const measuredZero = mapLinkedInCompanyPost(postRow({
      num_likes: 0,
      num_comments: '0',
    }), RANGE);
    assert.equal(measuredZero?.applause, 0);
    assert.equal(measuredZero?.conversation, 0);

    assert.equal(mapLinkedInCompanyPost(postRow({ num_likes: undefined }), RANGE), undefined);
    assert.equal(mapLinkedInCompanyPost(postRow({ num_comments: undefined }), RANGE), undefined);
  });

  it('enforces the inclusive exact window and requested company', () => {
    assert.ok(mapLinkedInCompanyPost(postRow({
      date_posted: RANGE.since.toISOString(),
    }), RANGE));
    assert.ok(mapLinkedInCompanyPost(postRow({
      date_posted: RANGE.until.toISOString(),
    }), RANGE));
    assert.equal(mapLinkedInCompanyPost(postRow({
      date_posted: '2026-07-19T23:59:59.999Z',
    }), RANGE), undefined);
    assert.equal(mapLinkedInCompanyPost(postRow({
      date_posted: '2026-07-28T00:00:00.000Z',
    }), RANGE), undefined);
    assert.equal(mapLinkedInCompanyPost(postRow({
      use_url: 'https://www.linkedin.com/company/a-different-company',
    }), { ...RANGE, expectedCompanyHandle: 'bostonglobemedia' }), undefined);
  });

  it('maps the observed media shapes without inventing unavailable media', () => {
    const video = mapLinkedInCompanyPost(postRow({
      images: [],
      videos: ['https://cdn.example.com/video.mp4'],
      video_thumbnail: { url: 'https://cdn.example.com/video.jpg' },
      video_duration: 92,
    }), RANGE);
    assert.equal(video?.type, 'video');
    assert.equal(video?.mediaUrl, 'https://cdn.example.com/video.mp4');
    assert.equal(video?.thumbnailUrl, 'https://cdn.example.com/video.jpg');
    assert.equal(video?.durationSec, 92);

    const document = mapLinkedInCompanyPost(postRow({
      images: [],
      document_cover_image: 'https://cdn.example.com/document.jpg',
    }), RANGE);
    assert.equal(document?.type, 'carousel');
    assert.equal(document?.mediaUrl, null);
    assert.equal(document?.thumbnailUrl, 'https://cdn.example.com/document.jpg');

    const linked = mapLinkedInCompanyPost(postRow({
      images: [],
      post_type: 'article',
      external_link_data: {
        url: 'https://example.com/article',
        image_url: 'https://cdn.example.com/article.jpg',
      },
    }), RANGE);
    assert.equal(linked?.type, 'article');
    assert.equal(linked?.mediaUrl, 'https://example.com/article');
    assert.equal(linked?.thumbnailUrl, 'https://cdn.example.com/article.jpg');

    const linkedArray = mapLinkedInCompanyPost(postRow({
      images: [],
      post_type: 'article',
      external_link_data: [{
        url: 'https://example.com/from-live-array-shape',
        image_url: 'https://cdn.example.com/from-live-array-shape.jpg',
      }],
    }), RANGE);
    assert.equal(linkedArray?.mediaUrl, 'https://example.com/from-live-array-shape');
    assert.equal(linkedArray?.thumbnailUrl, 'https://cdn.example.com/from-live-array-shape.jpg');
    assert.deepEqual(linked?.urls, [
      'https://example.com/story',
      'https://example.com/article',
    ]);
  });

  it('keeps explicit embedded links without retaining their vendor container', () => {
    const mapped = mapLinkedInCompanyPost(postRow({
      embedded_links: [
        'https://example.com/embedded-one',
        'https://example.com/embedded-two',
      ],
    }), RANGE);

    assert.deepEqual(mapped?.urls, [
      'https://example.com/story',
      'https://example.com/embedded-one',
      'https://example.com/embedded-two',
    ]);
    assert.equal('raw' in (mapped ?? {}), false);
  });
});

describe('Bright Data LinkedIn request contract', () => {
  it('uses the verified company dataset and bare-array request shape', async (t) => {
    t.mock.method(globalThis, 'fetch', async (
      input: RequestInfo | URL,
      init?: RequestInit,
    ) => {
      const url = String(input);
      assert.match(url, /dataset_id=gd_l1vikfnt1wgvvqz95w/);
      assert.doesNotMatch(url, /discover_by=/);
      assert.deepEqual(JSON.parse(String(init?.body)), [{
        url: 'https://www.linkedin.com/company/bostonglobemedia',
      }]);
      return new Response(JSON.stringify([{
        company_id: '6531',
        id: 'bostonglobemedia',
        name: 'Boston Globe Media',
        followers: 12_345,
        url: 'https://www.linkedin.com/company/bostonglobemedia',
      }]), { status: 200, headers: { 'content-type': 'application/json' } });
    });

    const result = await fetchLinkedInCompanyProfile('BostonGlobeMedia', 'test-key', {
      capturedAt: new Date('2026-08-04T15:00:00.000Z'),
    });

    assert.equal(result.profile.externalId, '6531');
    assert.equal(result.audience?.followers, 12_345);
    assert.deepEqual(result.warnings, []);
  });

  it('uses company_url discovery, filters locally, and remains terminal-incomplete', async (t) => {
    t.mock.method(globalThis, 'fetch', async (
      input: RequestInfo | URL,
      init?: RequestInit,
    ) => {
      const url = String(input);
      assert.match(url, /dataset_id=gd_lyy3tktm25m4avu764/);
      assert.match(url, /type=discover_new/);
      assert.match(url, /discover_by=company_url/);
      assert.deepEqual(JSON.parse(String(init?.body)), [{
        url: 'https://www.linkedin.com/company/bostonglobemedia',
        start_date: RANGE.since.toISOString(),
        end_date: RANGE.until.toISOString(),
      }]);
      return new Response(JSON.stringify([
        postRow({ id: 'inside-newer', date_posted: '2026-07-27T12:00:00.000Z' }),
        postRow({ id: 'inside-older', date_posted: '2026-07-21T12:00:00.000Z' }),
        postRow({ id: 'before', date_posted: '2026-07-19T23:59:59.999Z' }),
      ]), { status: 200, headers: { 'content-type': 'application/json' } });
    });

    const result = await fetchLinkedInCompanyPosts('bostonglobemedia', 'test-key', {
      ...RANGE,
      limit: 10,
    });

    assert.deepEqual(result.posts.map((post) => post.externalId), [
      'inside-newer',
      'inside-older',
    ]);
    assert.equal(result.hasMore, false);
    assert.equal(result.exhaustive, false);
    assert.match(result.incompleteReason, /no terminal cursor or completeness marker/i);
    assert.ok(result.warnings.some((warning) => /outside the exact window/i.test(warning)));
  });

  it('marks local truncation as terminal-incomplete rather than claiming pagination', async (t) => {
    t.mock.method(globalThis, 'fetch', async () => new Response(JSON.stringify([
      postRow({ id: 'newer', date_posted: '2026-07-27T12:00:00.000Z' }),
      postRow({ id: 'older', date_posted: '2026-07-21T12:00:00.000Z' }),
    ]), { status: 200, headers: { 'content-type': 'application/json' } }));

    const result = await fetchLinkedInCompanyPosts('bostonglobemedia', 'test-key', {
      ...RANGE,
      limit: 1,
    });

    assert.deepEqual(result.posts.map((post) => post.externalId), ['newer']);
    assert.equal(result.hasMore, false);
    assert.equal(result.exhaustive, false);
    assert.match(result.incompleteReason, /local 1-post limit without a durable data cursor/i);
  });
});
