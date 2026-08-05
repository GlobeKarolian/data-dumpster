import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { blueskyAdapter } from './bluesky';
import type { FetchContext } from './types';

const DID = 'did:plc:bostonglobe';
const WINDOW = {
  since: new Date('2026-07-01T00:00:00Z'),
  until: new Date('2026-07-31T23:59:59Z'),
};

function context(overrides: Partial<FetchContext> = {}): FetchContext {
  return {
    handle: 'bostonglobe.bsky.social',
    externalId: DID,
    cursor: {},
    ...WINDOW,
    credentials: {},
    limit: 2,
    ...overrides,
  };
}

function profile(): Record<string, unknown> {
  return {
    did: DID,
    handle: 'bostonglobe.bsky.social',
    displayName: 'The Boston Globe',
    followersCount: 100,
    followsCount: 10,
    postsCount: 3,
  };
}

function feedPost(id: string, createdAt: string): Record<string, unknown> {
  return {
    post: {
      uri: `at://${DID}/app.bsky.feed.post/${id}`,
      author: { did: DID, handle: 'bostonglobe.bsky.social' },
      record: { createdAt, text: `Post ${id}` },
      indexedAt: createdAt,
      likeCount: 1,
      replyCount: 2,
      repostCount: 3,
      quoteCount: 4,
    },
  };
}

function json(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}

describe('Bluesky completeness', { concurrency: false }, () => {
  it('persists the cursor after the consumed page and binds it to the attempted window', async () => {
    const seenCursors: Array<string | null> = [];
    const original = globalThis.fetch;
    globalThis.fetch = async (input) => {
      const url = new URL(typeof input === 'string' || input instanceof URL ? input : input.url);
      if (url.pathname.endsWith('/app.bsky.actor.getProfile')) return json(profile());
      if (!url.pathname.endsWith('/app.bsky.feed.getAuthorFeed')) {
        throw new Error('Unexpected Bluesky endpoint: ' + url.pathname);
      }

      const cursor = url.searchParams.get('cursor');
      seenCursors.push(cursor);
      if (!cursor) {
        assert.equal(url.searchParams.get('limit'), '2');
        return json({
          feed: [
            feedPost('one', '2026-07-30T12:00:00Z'),
            feedPost('two', '2026-07-29T12:00:00Z'),
          ],
          cursor: 'after-two',
        });
      }
      assert.equal(cursor, 'after-two');
      return json({ feed: [feedPost('three', '2026-07-28T12:00:00Z')] });
    };

    try {
      const first = await blueskyAdapter.fetch(context());
      assert.equal(first.hasMore, true);
      assert.equal(first.exhaustive, false);
      assert.equal(first.cursor?.resumeCursor, 'after-two');
      assert.equal(first.cursor?.nextCursor, 'after-two');
      assert.equal(first.cursor?.windowSince, WINDOW.since.toISOString());
      assert.equal(first.cursor?.windowUntil, WINDOW.until.toISOString());

      const second = await blueskyAdapter.fetch(context({ cursor: first.cursor }));
      assert.equal(second.posts[0]?.externalId, `at://${DID}/app.bsky.feed.post/three`);
      assert.equal(second.hasMore, false);
      assert.equal(second.exhaustive, true);
      assert.equal(second.cursor?.resumeCursor, null);
      assert.equal(second.cursor?.nextCursor, null);
    } finally {
      globalThis.fetch = original;
    }

    assert.deepEqual(seenCursors, [null, 'after-two']);
  });

  it('ignores a continuation cursor from a different requested window', async () => {
    const seenCursors: Array<string | null> = [];
    const original = globalThis.fetch;
    globalThis.fetch = async (input) => {
      const url = new URL(typeof input === 'string' || input instanceof URL ? input : input.url);
      if (url.pathname.endsWith('/app.bsky.actor.getProfile')) return json(profile());
      seenCursors.push(url.searchParams.get('cursor'));
      return json({ feed: [] });
    };

    try {
      await blueskyAdapter.fetch(context({
        until: new Date('2026-08-01T23:59:59Z'),
        cursor: {
          resumeCursor: 'stale-cursor',
          windowSince: WINDOW.since.toISOString(),
          windowUntil: WINDOW.until.toISOString(),
        },
      }));
    } finally {
      globalThis.fetch = original;
    }

    assert.deepEqual(seenCursors, [null]);
  });
});
