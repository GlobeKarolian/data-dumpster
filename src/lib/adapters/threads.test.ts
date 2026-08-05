import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { threadsAdapter } from './threads';
import type { FetchContext } from './types';

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function context(overrides: Partial<FetchContext> = {}): FetchContext {
  return {
    handle: 'bostonglobe',
    externalId: null,
    cursor: {},
    since: new Date('2026-07-01T00:00:00Z'),
    until: new Date('2026-07-31T23:59:59Z'),
    credentials: {},
    limit: 50,
    ...overrides,
  };
}

describe('Threads public source identity', { concurrency: false }, () => {
  it('uses Bright Data exclusively when both sources are configured', async (t) => {
    const calls: string[] = [];
    t.mock.method(globalThis, 'fetch', async (input: RequestInfo | URL) => {
      const url = String(input);
      calls.push(url);
      assert.match(url, /api\.brightdata\.com/);
      return json([{
        profile_id: 'threads-user-1',
        profile_name: 'The Boston Globe',
        number_of_followers: 100_000,
        url: 'https://www.threads.com/@bostonglobe',
      }]);
    });

    const profile = await threadsAdapter.resolveProfile('bostonglobe', {
      ensembleDataToken: 'ensemble-key',
      brightDataApiKey: 'bright-key',
    });

    assert.equal(profile.externalId, 'threads-user-1');
    assert.equal(profile.meta?.source, 'brightdata');
    assert.equal(calls.length, 1);
    assert.ok(calls.every((url) => !url.includes('ensembledata.com')));
  });

  it('uses EnsembleData only when Bright Data is absent', async (t) => {
    const calls: string[] = [];
    t.mock.method(globalThis, 'fetch', async (input: RequestInfo | URL) => {
      const url = String(input);
      calls.push(url);
      assert.match(url, /ensembledata\.com\/apis\/threads\/user\/search/);
      return json({
        data: [{
          node: {
            pk: 'threads-user-1',
            username: 'bostonglobe',
            full_name: 'The Boston Globe',
            follower_count: 100_000,
          },
        }],
      });
    });

    const profile = await threadsAdapter.resolveProfile('bostonglobe', {
      ensembleDataToken: 'ensemble-key',
      brightDataApiKey: '',
    });

    assert.equal(profile.externalId, 'threads-user-1');
    assert.equal(profile.meta?.source, 'ensembledata');
    assert.equal(calls.length, 1);
  });

  it('uses Bright Data exclusively during collection when both sources are configured', async (t) => {
    const calls: string[] = [];
    t.mock.method(globalThis, 'fetch', async (input: RequestInfo | URL) => {
      const url = String(input);
      calls.push(url);
      if (url.includes('ensembledata.com/')) {
        throw new Error('EnsembleData must not be called when Bright Data is configured.');
      }
      if (url.includes('dataset_id=gd_md75myxy14rihbjksa')) {
        return json([{
          post_id: 'thread-code',
          post_time: '2026-07-20T12:00:00.000Z',
          url: 'https://www.threads.com/@bostonglobe/post/thread-code',
          post_content: 'A Threads video',
          images: ['https://scontent.example.cdninstagram.com/cover.jpg'],
          videos: ['https://scontent.example.cdninstagram.com/video.mp4'],
        }]);
      }
      return json([{
        profile_id: 'threads-user-1',
        profile_name: 'The Boston Globe',
        number_of_followers: 100_000,
        url: 'https://www.threads.com/@bostonglobe',
        threads: [],
      }]);
    });

    const result = await threadsAdapter.fetch(context({
      credentials: {
        ensembleDataToken: 'ensemble-key',
        brightDataApiKey: 'bright-key',
      },
    }));

    assert.equal(result.profile?.externalId, 'threads-user-1');
    assert.equal(result.cursor?.source, 'brightdata');
    assert.equal(result.exhaustive, false);
    assert.equal(result.posts[0]?.thumbnailUrl, 'https://scontent.example.cdninstagram.com/cover.jpg');
    assert.equal(result.posts[0]?.mediaUrl, 'https://scontent.example.cdninstagram.com/video.mp4');
    assert.equal(calls.length, 2);
    assert.ok(calls.every((url) => !url.includes('ensembledata.com')));
  });

  it('does not fall back to EnsembleData after a Bright Data stage fails', async (t) => {
    const calls: string[] = [];
    t.mock.method(globalThis, 'fetch', async (input: RequestInfo | URL) => {
      const url = String(input);
      calls.push(url);
      if (url.includes('ensembledata.com/')) {
        throw new Error('EnsembleData must not be called after a Bright Data failure.');
      }
      return json({ error: 'authentication rejected' }, 401);
    });

    await assert.rejects(threadsAdapter.fetch(context({
      credentials: {
        ensembleDataToken: 'ensemble-key',
        brightDataApiKey: 'bright-key',
      },
    })));
    assert.ok(calls.length > 0);
    assert.ok(calls.every((url) => !url.includes('ensembledata.com')));
  });

  it('does not fabricate a platform id from the handle', async (t) => {
    t.mock.method(globalThis, 'fetch', async () => new Response(JSON.stringify([{
      profile_name: 'The Boston Globe',
      number_of_followers: 100_000,
      url: 'https://www.threads.com/@bostonglobe',
    }]), { status: 200, headers: { 'content-type': 'application/json' } }));

    await assert.rejects(
      threadsAdapter.resolveProfile('bostonglobe', {
        ensembleDataToken: '',
        brightDataApiKey: 'bright-key',
      }),
      /without a stable platform id.*No observations were accepted/i,
    );
  });

  it('rejects an EnsembleData search result without a native profile id', async (t) => {
    t.mock.method(globalThis, 'fetch', async () => json({
      data: [{ node: { username: 'bostonglobe', full_name: 'The Boston Globe' } }],
    }));

    await assert.rejects(
      threadsAdapter.resolveProfile('bostonglobe', {
        ensembleDataToken: 'ensemble-key',
        brightDataApiKey: '',
      }),
      /search returned no id/i,
    );
  });
});
