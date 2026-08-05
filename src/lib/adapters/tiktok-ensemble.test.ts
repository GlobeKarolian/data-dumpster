import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { tiktokAdapter } from './tiktok';

describe('TikTok public profile resolution', () => {
  it('uses Bright Data exclusively when both public sources are configured', async (t) => {
    const calls: string[] = [];
    t.mock.method(globalThis, 'fetch', async (input: RequestInfo | URL) => {
      const url = String(input);
      calls.push(url);
      assert.match(url, /api\.brightdata\.com\/datasets\/v3/);
      return new Response(JSON.stringify([{
        id: 'tt-bright-1',
        account_id: 'bostonglobe',
        nickname: 'The Boston Globe',
        followers: 320_000,
        url: 'https://www.tiktok.com/@bostonglobe',
      }]), { status: 200, headers: { 'content-type': 'application/json' } });
    });

    const profile = await tiktokAdapter.resolveProfile('bostonglobe', {
      ensembleDataToken: 'ensemble-token',
      brightDataApiKey: 'bright-key',
    });

    assert.equal(profile.externalId, 'tt-bright-1');
    assert.equal(profile.handle, 'bostonglobe');
    assert.equal(profile.followers, 320_000);
    assert.equal(profile.meta?.source, 'brightdata');
    assert.equal(calls.length, 1);
    assert.ok(calls.every((url) => !url.includes('ensembledata.com')));
  });

  it('uses EnsembleData only when Bright Data is absent', async (t) => {
    t.mock.method(globalThis, 'fetch', async (input: RequestInfo | URL) => {
      assert.match(String(input), /\/tt\/user\/info\?/);
      return new Response(JSON.stringify({
        data: {
          user: {
            id: 'tiktok-user-1',
            uniqueId: 'bostonglobe',
            nickname: 'The Boston Globe',
          },
          stats: { followerCount: 321_000 },
        },
      }), { status: 200, headers: { 'content-type': 'application/json' } });
    });

    const profile = await tiktokAdapter.resolveProfile('bostonglobe', {
      ensembleDataToken: 'ensemble-token',
      brightDataApiKey: '',
    });

    assert.equal(profile.externalId, 'tiktok-user-1');
    assert.equal(profile.followers, 321_000);
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
      return new Response(JSON.stringify({ error: 'snapshot failed' }), { status: 401 });
    });

    await assert.rejects(tiktokAdapter.resolveProfile('bostonglobe', {
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
      if (url.includes('gd_l1villgoiiidt09ci')) {
        return new Response(JSON.stringify([{
          id: 'tt-bright-fallback',
          account_id: 'bostonglobe',
          nickname: 'The Boston Globe',
          followers: 320_000,
          url: 'https://www.tiktok.com/@bostonglobe',
        }]), { status: 200, headers: { 'content-type': 'application/json' } });
      }
      return new Response(JSON.stringify([{
        post_id: 'tt-post-1',
        url: 'https://www.tiktok.com/@bostonglobe/video/tt-post-1',
        date_posted: '2026-08-02T12:00:00.000Z',
        description: 'Boston news',
        likes: 100,
        comments: 5,
        shares: 3,
        views: 1_000,
        cover: { url_list: ['https://cdn.example/tiktok-cover.jpg'] },
        video_url: { url_list: ['https://cdn.example/tiktok-video.mp4'] },
      }]), { status: 200, headers: { 'content-type': 'application/json' } });
    });

    const result = await tiktokAdapter.fetch({
      handle: 'bostonglobe',
      externalId: 'tt-bright-fallback',
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
    assert.equal(result.posts[0]?.thumbnailUrl, 'https://cdn.example/tiktok-cover.jpg');
    assert.equal(result.posts[0]?.mediaUrl, 'https://cdn.example/tiktok-video.mp4');
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

    await assert.rejects(tiktokAdapter.fetch({
      handle: 'bostonglobe',
      externalId: 'tt-bright-1',
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

  it('maps the observed EnsembleData cover and playback url_list objects', async (t) => {
    t.mock.method(globalThis, 'fetch', async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('/tt/user/info')) {
        return new Response(JSON.stringify({
          data: {
            user: { id: 'tiktok-user-1', uniqueId: 'bostonglobe' },
            stats: { followerCount: 321_000 },
          },
        }), { status: 200, headers: { 'content-type': 'application/json' } });
      }
      assert.match(url, /\/tt\/user\/posts/);
      return new Response(JSON.stringify({
        data: [{
          aweme_id: '7666210267478379790',
          create_time: 1_775_000_000,
          desc: 'Boston news',
          statistics: { digg_count: 100, comment_count: 5, share_count: 3, play_count: 1_000 },
          video: {
            duration: 12_000,
            cover: { url_list: ['https://cdn.example/tiktok-cover.jpg'] },
            play_addr: { url_list: ['https://cdn.example/tiktok-video.mp4'] },
          },
        }],
      }), { status: 200, headers: { 'content-type': 'application/json' } });
    });

    const result = await tiktokAdapter.fetch({
      handle: 'bostonglobe',
      externalId: 'tiktok-user-1',
      cursor: { __isOwned: false },
      since: new Date('2026-03-30T00:00:00.000Z'),
      until: new Date('2026-04-10T00:00:00.000Z'),
      credentials: { ensembleDataToken: 'ensemble-token' },
      limit: 50,
    });

    assert.equal(result.posts.length, 1);
    assert.equal(result.posts[0]?.thumbnailUrl, 'https://cdn.example/tiktok-cover.jpg');
    assert.equal(result.posts[0]?.mediaUrl, 'https://cdn.example/tiktok-video.mp4');
    assert.equal(result.posts[0]?.durationSec, 12);
  });

  it('does not fabricate a TikTok platform id from account_id, sec_uid, or the handle', async (t) => {
    t.mock.method(globalThis, 'fetch', async () => new Response(JSON.stringify([{
      account_id: 'bostonglobe',
      sec_uid: 'MS4wLjABAAAA-bright-only',
      nickname: 'The Boston Globe',
      followers: 320_000,
    }]), { status: 200, headers: { 'content-type': 'application/json' } }));

    await assert.rejects(
      tiktokAdapter.resolveProfile('bostonglobe', {
        ensembleDataToken: '',
        brightDataApiKey: 'bright-key',
      }),
      /without the canonical stable account id.*account_id.*sec_uid.*no observations were accepted/i,
    );
  });

  it('does not switch the canonical account id to EnsembleData secUid', async (t) => {
    t.mock.method(globalThis, 'fetch', async () => new Response(JSON.stringify({
      data: {
        user: {
          uniqueId: 'bostonglobe',
          secUid: 'MS4wLjABAAAA-ensemble-only',
        },
        stats: { followerCount: 321_000 },
      },
    }), { status: 200, headers: { 'content-type': 'application/json' } }));

    await assert.rejects(
      tiktokAdapter.resolveProfile('bostonglobe', {
        ensembleDataToken: 'ensemble-token',
        brightDataApiKey: '',
      }),
      /without the canonical stable account id.*secUid.*no observations were accepted/i,
    );
  });
});
