import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { mapInstagramEnsembleReel } from './instagram-ensemble';
import { instagramAdapter } from './meta';

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

describe('Instagram public profile resolution', () => {
  it('uses Bright Data exclusively when both public sources are configured', async (t) => {
    const calls: string[] = [];
    t.mock.method(globalThis, 'fetch', async (input: RequestInfo | URL) => {
      const url = String(input);
      calls.push(url);
      assert.match(url, /api\.brightdata\.com\/datasets\/v3/);
      return new Response(JSON.stringify([{
        id: 'ig-bright-1',
        account: 'bostonglobe',
        full_name: 'The Boston Globe',
        followers: 900_000,
        profile_url: 'https://www.instagram.com/bostonglobe/',
      }]), { status: 200, headers: { 'content-type': 'application/json' } });
    });

    const profile = await instagramAdapter.resolveProfile('bostonglobe', {
      ensembleDataToken: 'ensemble-token',
      brightDataApiKey: 'bright-key',
    });

    assert.equal(profile.externalId, 'ig-bright-1');
    assert.equal(profile.handle, 'bostonglobe');
    assert.equal(profile.followers, 900_000);
    assert.equal(profile.meta?.source, 'brightdata');
    assert.equal(calls.length, 1);
    assert.ok(calls.every((url) => !url.includes('ensembledata.com')));
  });

  it('uses EnsembleData only when Bright Data is absent', async (t) => {
    t.mock.method(globalThis, 'fetch', async (input: RequestInfo | URL) => {
      const url = String(input);
      assert.match(url, /\/instagram\/user\/detailed-info\?/);
      return new Response(JSON.stringify({
        data: {
          user: {
            id: '123456789',
            username: 'bostonglobe',
            full_name: 'The Boston Globe',
            edge_followed_by: { count: 912_345 },
          },
        },
      }), { status: 200, headers: { 'content-type': 'application/json' } });
    });

    const profile = await instagramAdapter.resolveProfile('bostonglobe', {
      ensembleDataToken: 'ensemble-token',
      brightDataApiKey: '',
    });

    assert.equal(profile.externalId, '123456789');
    assert.equal(profile.followers, 912_345);
    assert.equal(profile.meta?.source, 'ensembledata');
  });

  it('does not fall back to EnsembleData when Bright Data profile resolution fails', async (t) => {
    const calls: string[] = [];
    t.mock.method(globalThis, 'fetch', async (input: RequestInfo | URL) => {
      const url = String(input);
      calls.push(url);
      if (url.includes('ensembledata.com')) {
        throw new Error('EnsembleData must not be called after a Bright Data failure.');
      }
      return new Response(JSON.stringify({ error: 'snapshot failed' }), { status: 500 });
    });

    await assert.rejects(instagramAdapter.resolveProfile('bostonglobe', {
      ensembleDataToken: 'ensemble-token',
      brightDataApiKey: 'bright-key',
    }));
    assert.ok(calls.length > 0);
    assert.ok(calls.every((url) => !url.includes('ensembledata.com')));
  });

  it('uses Bright Data exclusively for collection when both sources are configured', async (t) => {
    const calls: string[] = [];
    t.mock.method(globalThis, 'fetch', async (input: RequestInfo | URL) => {
      const url = String(input);
      calls.push(url);
      if (url.includes('ensembledata.com')) {
        throw new Error('EnsembleData must not be called when Bright Data is configured.');
      }
      return new Response(JSON.stringify([{
        id: 'ig-bright-fallback',
        account: 'bostonglobe',
        followers: 900_000,
        profile_url: 'https://www.instagram.com/bostonglobe/',
        posts: [{
          id: 'ig-post-1',
          datetime: '2026-08-02T12:00:00.000Z',
          caption: 'Boston news',
          likes: 100,
          comments: 5,
          image_url: 'https://cdn.example/post.jpg',
        }],
      }]), { status: 200, headers: { 'content-type': 'application/json' } });
    });

    const result = await instagramAdapter.fetch({
      handle: 'bostonglobe',
      externalId: 'ig-bright-fallback',
      cursor: { __isOwned: false },
      since: new Date('2026-08-01T00:00:00.000Z'),
      until: new Date('2026-08-03T00:00:00.000Z'),
      credentials: {
        ensembleDataToken: 'exhausted-ensemble-token',
        brightDataApiKey: 'bright-key',
      },
      limit: 50,
    });

    assert.equal(result.cursor?.source, 'brightdata');
    assert.equal(result.posts.length, 1);
    assert.ok(calls.length > 0);
    assert.ok(calls.every((url) => !url.includes('ensembledata.com')));
  });

  it('does not fall back to EnsembleData after a Bright Data collection stage fails', async (t) => {
    const calls: string[] = [];
    t.mock.method(globalThis, 'fetch', async (input: RequestInfo | URL) => {
      const url = String(input);
      calls.push(url);
      if (url.includes('ensembledata.com')) {
        throw new Error('EnsembleData must not be called after a Bright Data failure.');
      }
      return new Response(JSON.stringify({ error: 'snapshot failed' }), { status: 401 });
    });

    await assert.rejects(instagramAdapter.fetch({
      handle: 'bostonglobe',
      externalId: 'ig-bright-1',
      cursor: { __isOwned: false },
      since: new Date('2026-08-01T00:00:00.000Z'),
      until: new Date('2026-08-03T00:00:00.000Z'),
      credentials: {
        ensembleDataToken: 'ensemble-token',
        brightDataApiKey: 'bright-key',
      },
      limit: 50,
    }));
    assert.ok(calls.length > 0);
    assert.ok(calls.every((url) => !url.includes('ensembledata.com')));
  });

  it('uses the observed post-row owner id to bridge Bright Data and Ensemble identities', async (t) => {
    let brightCalls = 0;
    t.mock.method(globalThis, 'fetch', async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('ensembledata.com')) {
        return new Response(JSON.stringify({ detail: 'daily quota exhausted' }), { status: 495 });
      }

      brightCalls += 1;
      if (brightCalls === 1) {
        return new Response(JSON.stringify([{
          id: '17841401723943574',
          account: 'theharvardcrimson',
          followers: 100_000,
          posts: [],
        }]), { status: 200, headers: { 'content-type': 'application/json' } });
      }
      return new Response(JSON.stringify([{
        post_id: '3948561070918037564',
        pk: '3948561070918037564',
        shortcode: 'DbMG1-mAXA8',
        date_posted: '2026-07-24T20:33:07.000Z',
        url: 'https://www.instagram.com/p/DbMG1-mAXA8/',
        user_posted: 'theharvardcrimson',
        user_posted_id: '1508793464',
        followers: 100_000,
        likes: 200,
        num_comments: 4,
      }, {
        // Discovery includes collaboration posts owned by another account.
        // They remain valid content but cannot redefine the requested profile.
        post_id: '3949999999999999999',
        date_posted: '2026-07-25T20:33:07.000Z',
        url: 'https://www.instagram.com/p/Collaborator/',
        user_posted: 'pablotorrefindsout',
        user_posted_id: '60918747034',
        followers: 100_000,
        likes: 300,
        num_comments: 6,
      }]), { status: 200, headers: { 'content-type': 'application/json' } });
    });

    const result = await instagramAdapter.fetch({
      handle: 'theharvardcrimson',
      externalId: '1508793464',
      cursor: { __isOwned: false, source: 'ensembledata' },
      since: new Date('2026-07-01T00:00:00.000Z'),
      until: new Date('2026-08-03T00:00:00.000Z'),
      credentials: {
        ensembleDataToken: 'exhausted-ensemble-token',
        brightDataApiKey: 'bright-key',
      },
      limit: 50,
    });

    assert.equal(result.profile?.externalId, '1508793464');
    assert.equal(result.profile?.meta?.profileEndpointId, '17841401723943574');
    assert.equal(result.posts[0]?.externalId, '3948561070918037564');
  });

  it('does not fabricate an Instagram platform id from the handle', async (t) => {
    t.mock.method(globalThis, 'fetch', async () => new Response(JSON.stringify([{
      account: 'bostonglobe',
      full_name: 'The Boston Globe',
      followers: 900_000,
    }]), { status: 200, headers: { 'content-type': 'application/json' } }));

    await assert.rejects(
      instagramAdapter.resolveProfile('bostonglobe', {
        ensembleDataToken: '',
        brightDataApiKey: 'bright-key',
      }),
      /without a stable platform id.*No observations were accepted/i,
    );
  });
});
