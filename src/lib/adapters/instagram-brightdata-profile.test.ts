import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { mapInstagramProfileRow } from './instagram-brightdata';

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
