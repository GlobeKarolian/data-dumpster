import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { mapInstagramProfileRow, postsFromProfile } from './instagram-brightdata';

describe('Bright Data Instagram profile mapping', () => {
  it('maps the stable id and public stock fields from the live profile schema', () => {
    const { profile, audience } = mapInstagramProfileRow({
      account: 'sentedcruz',
      id: '638343424',
      fbid: '17841400222729974',
      followers: 912_345,
      following: 321,
      posts_count: 1_234,
      profile_name: 'Senator Ted Cruz',
      profile_url: 'https://instagram.com/sentedcruz',
      is_verified: true,
    }, 'sentedcruz');

    assert.equal(profile.externalId, '638343424');
    assert.equal(profile.handle, 'sentedcruz');
    assert.equal(profile.followers, 912_345);
    assert.equal(audience?.followers, 912_345);
    assert.equal(audience?.following, 321);
    assert.deepEqual(audience?.extra, { posts: 1_234 });
  });
});

describe('Instagram profile-embedded post stubs', () => {
  const since = new Date('2026-08-20T00:00:00Z');
  const until = new Date('2026-08-26T00:00:00Z');

  it('refuses a page of stubs that carry no engagement fields', () => {
    // The exact seven-field shape the vendor began returning around 22 Aug
    // 2026, captured from a live wmur9 profile row. Parsing these as posts
    // put three days of Instagram on screen at zero engagement and 8:00 PM,
    // because a date-only datetime renders as midnight UTC.
    const result = postsFromProfile({
      account: 'wmur9',
      posts: [
        {
          caption: 'Country music icon Dolly Parton died after a brief battle with cancer.',
          datetime: '2026-08-25T00:00:00.000Z',
          id: '3971856069475707958',
          image_url: 'https://scontent.cdninstagram.com/x.jpg',
          post_hashtags: null,
          content_type: 'Photo',
          url: 'https://www.instagram.com/p/abc/',
        },
        {
          caption: 'Another stub with no counts.',
          datetime: '2026-08-24T00:00:00.000Z',
          id: '3971856069475707959',
          image_url: 'https://scontent.cdninstagram.com/y.jpg',
          post_hashtags: null,
          content_type: 'Video',
          url: 'https://www.instagram.com/p/def/',
        },
      ],
    }, 'wmur9', since, until);

    assert.equal(result.posts.length, 0, 'a metric-less stub must never become a post observation');
    assert.equal(result.stubsUnusable, true);
    assert.match(result.incompleteReason ?? '', /no engagement fields/);
    assert.match(result.incompleteReason ?? '', /date-ranged post dataset/);
  });

  it('still accepts stubs that carry engagement, and skips the metric-less ones beside them', () => {
    const result = postsFromProfile({
      account: 'wmur9',
      posts: [
        {
          id: 'with-metrics',
          datetime: '2026-08-24T15:30:00.000Z',
          caption: 'A real observation.',
          url: 'https://www.instagram.com/p/real/',
          likes: 120,
          comments: 14,
          content_type: 'Photo',
        },
        {
          id: 'existence-only',
          datetime: '2026-08-24T00:00:00.000Z',
          caption: 'A stub beside it with no counts.',
          url: 'https://www.instagram.com/p/stub/',
          content_type: 'Photo',
        },
      ],
    }, 'wmur9', since, until);

    assert.equal(result.stubsUnusable, undefined);
    assert.equal(result.posts.length, 1);
    assert.equal(result.posts[0].externalId, 'with-metrics');
    assert.equal(result.posts[0].applause, 120);
    assert.equal(result.posts[0].conversation, 14);
  });
});
