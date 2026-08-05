import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { redditAdapter, parseRedditPage, parseRedditUserPage } from './reddit';
import type { FetchContext } from './types';

function listingPost(
  id: string,
  createdUtc: number,
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    kind: 't3',
    data: {
      id,
      name: 't3_' + id,
      title: 'A Boston story #LocalNews',
      selftext: 'Read more from @BostonGlobe',
      score: 81,
      ups: 99,
      num_comments: 12,
      num_crossposts: 3,
      created_utc: createdUtc,
      permalink: '/r/boston/comments/' + id + '/a_boston_story/',
      url: 'https://example.com/story',
      domain: 'example.com',
      thumbnail: 'https://preview.redd.it/thumb.jpg?width=140&amp;format=pjpg',
      is_self: false,
      is_video: false,
      post_hint: 'link',
      subreddit: 'boston',
      subreddit_id: 't5_2qh3r',
      subreddit_name_prefixed: 'r/boston',
      subreddit_subscribers: 684_321,
      subreddit_type: 'public',
      ...overrides,
    },
  };
}

function response(
  posts: Record<string, unknown>[],
  nextCursor: string | null = null,
): Record<string, unknown> {
  return { data: { nextCursor, posts } };
}

function userPost(
  id: string,
  createdUtc: number,
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return listingPost(id, createdUtc, {
    author: 'bostonglobe',
    author_fullname: 't2_k4udmbr',
    subreddit: 'CambridgeMA',
    subreddit_subscribers: 51_564,
    permalink: '/r/CambridgeMA/comments/' + id + '/a_boston_story/',
    ...overrides,
  });
}

function context(overrides: Partial<FetchContext> = {}): FetchContext {
  return {
    handle: 'boston',
    externalId: null,
    cursor: {},
    since: new Date('2026-07-01T00:00:00Z'),
    until: new Date('2026-07-31T23:59:59Z'),
    credentials: { ensembleDataToken: 'test-token' },
    limit: 50,
    ...overrides,
  };
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function urlOf(input: Parameters<typeof fetch>[0]): URL {
  if (typeof input === 'string') return new URL(input);
  if (input instanceof URL) return input;
  return new URL(input.url);
}

async function withMockFetch<T>(
  mock: typeof fetch,
  run: () => Promise<T>,
): Promise<T> {
  const original = globalThis.fetch;
  globalThis.fetch = mock;
  try {
    return await run();
  } finally {
    globalThis.fetch = original;
  }
}

describe('Reddit handle parsing', () => {
  it('accepts user accounts and rejects new community sources', () => {
    assert.equal(redditAdapter.parseHandle('BostonGlobe'), 'u/bostonglobe');
    assert.throws(() => redditAdapter.parseHandle('r/Boston'), /must be user accounts/);
    assert.throws(() => redditAdapter.parseHandle('/r/boston/'), /must be user accounts/);
    assert.throws(
      () => redditAdapter.parseHandle('https://old.reddit.com/r/Boston/comments/abc/story'),
      /must be user accounts/,
    );
  });

  it('namespaces user accounts while preserving legacy bare subreddit handles', () => {
    assert.equal(redditAdapter.parseHandle('u/Some-One'), 'u/some-one');
    assert.equal(redditAdapter.parseHandle('/user/Some_One/'), 'u/some_one');
    assert.equal(
      redditAdapter.parseHandle('https://www.reddit.com/user/bostonglobe/'),
      'u/bostonglobe',
    );
    assert.equal(
      redditAdapter.parseHandle('https://reddit.com/u/SomeOne/comments'),
      'u/someone',
    );
    assert.throws(() => redditAdapter.parseHandle('r/boston'), /must be user accounts/);
  });

  it('rejects foreign hosts and invalid source names', () => {
    assert.throws(
      () => redditAdapter.parseHandle('https://notreddit.com/r/boston'),
      /Not a Reddit URL/,
    );
    assert.throws(() => redditAdapter.parseHandle('r/a-b'), /Invalid Reddit subreddit/);
    assert.throws(() => redditAdapter.parseHandle('u/a.b'), /Invalid Reddit username/);
  });
});

describe('Reddit response parsing', () => {
  it('maps the observed listing wrapper, audience stock and engagement semantics', () => {
    const parsed = parseRedditPage(response([
      listingPost('inside', Date.parse('2026-07-20T12:00:00Z') / 1000),
      listingPost('old', Date.parse('2026-06-20T12:00:00Z') / 1000),
      listingPost('wrong', Date.parse('2026-07-20T12:00:00Z') / 1000, {
        subreddit: 'cambridge',
      }),
    ], 'cursor-2'), {
      handle: 'boston',
      since: new Date('2026-07-01T00:00:00Z'),
      until: new Date('2026-07-31T23:59:59Z'),
      observedAt: new Date('2026-07-30T16:00:00Z'),
    });

    assert.equal(parsed.rowCount, 3);
    assert.equal(parsed.matchedCount, 2);
    assert.equal(parsed.posts.length, 1);
    assert.equal(parsed.nextCursor, 'cursor-2');
    assert.equal(parsed.profile?.externalId, 't5_2qh3r');
    assert.equal(parsed.profile?.followers, 684_321);
    assert.equal(parsed.audience?.day, '2026-07-30');
    assert.equal(parsed.audience?.followers, 684_321);

    const post = parsed.posts[0];
    assert.equal(post.externalId, 'inside');
    assert.equal(post.type, 'link');
    assert.equal(post.applause, 81);
    assert.equal(post.conversation, 12);
    assert.equal(post.amplification, 3);
    assert.equal(post.saves, 0);
    assert.equal(post.views, 0);
    assert.equal(post.permalink, 'https://www.reddit.com/r/boston/comments/inside/a_boston_story/');
    assert.equal(post.thumbnailUrl, 'https://preview.redd.it/thumb.jpg?width=140&format=pjpg');
    assert.deepEqual(post.hashtags, ['localnews']);
    assert.deepEqual(post.mentions, ['bostonglobe']);
    assert.deepEqual(post.urls, ['https://example.com/story']);
  });

  it('classifies self, image, gallery and video posts and reads preview media', () => {
    const created = Date.parse('2026-07-20T12:00:00Z') / 1000;
    const parsed = parseRedditPage(response([
      listingPost('self', created, {
        is_self: true,
        post_hint: undefined,
        url: 'https://www.reddit.com/r/boston/comments/self/',
      }),
      listingPost('image', created, {
        post_hint: 'image',
        domain: 'i.redd.it',
        url: 'https://i.redd.it/photo.jpg',
        preview: {
          images: [{ source: { url: 'https://preview.redd.it/photo.jpg?a=1&amp;b=2' } }],
        },
      }),
      listingPost('gallery', created, {
        is_gallery: true,
        post_hint: undefined,
        media_metadata: {
          one: { s: { u: 'https://preview.redd.it/one.jpg?x=1&amp;y=2' } },
          two: { s: { u: 'https://preview.redd.it/two.jpg' } },
        },
      }),
      listingPost('video', created, {
        is_video: true,
        post_hint: 'hosted:video',
        secure_media: {
          reddit_video: {
            fallback_url: 'https://v.redd.it/clip/DASH_720.mp4?source=fallback&amp;x=1',
            duration: 43,
          },
        },
        preview: {
          images: [{ source: { url: 'https://preview.redd.it/video.jpg?x=1&amp;y=2' } }],
        },
      }),
    ]), {
      handle: 'boston',
      since: new Date('2026-07-01T00:00:00Z'),
      until: new Date('2026-07-31T23:59:59Z'),
    });

    const byId = new Map(parsed.posts.map((post) => [post.externalId, post]));
    assert.equal(byId.get('self')?.type, 'text');
    assert.equal(byId.get('image')?.type, 'photo');
    assert.equal(byId.get('image')?.mediaUrl, 'https://i.redd.it/photo.jpg');
    assert.equal(byId.get('gallery')?.type, 'carousel');
    assert.equal(byId.get('gallery')?.mediaUrl, 'https://preview.redd.it/one.jpg?x=1&y=2');
    assert.equal(byId.get('video')?.type, 'video');
    assert.equal(
      byId.get('video')?.mediaUrl,
      'https://v.redd.it/clip/DASH_720.mp4?source=fallback&x=1',
    );
    assert.equal(byId.get('video')?.thumbnailUrl, 'https://preview.redd.it/video.jpg?x=1&y=2');
    assert.equal(byId.get('video')?.durationSec, 43);
  });

  it('uses ups only when score is absent and clamps a negative score to zero', () => {
    const created = Date.parse('2026-07-20T12:00:00Z') / 1000;
    const parsed = parseRedditPage(response([
      listingPost('fallback', created, { score: undefined, ups: 17 }),
      listingPost('negative', created, { score: -4, ups: 91 }),
    ]), {
      handle: 'boston',
      since: new Date('2026-07-01T00:00:00Z'),
      until: new Date('2026-07-31T23:59:59Z'),
    });

    const byId = new Map(parsed.posts.map((post) => [post.externalId, post]));
    assert.equal(byId.get('fallback')?.applause, 17);
    assert.equal(byId.get('negative')?.applause, 0);
  });

  it('maps an exact user feed without borrowing the post community audience', () => {
    const created = Date.parse('2026-07-20T12:00:00Z') / 1000;
    const parsed = parseRedditUserPage(response([
      userPost('inside', created),
      userPost('wrong-author', created, { author: 'someone_else' }),
    ], 't3_next'), {
      handle: 'bostonglobe',
      since: new Date('2026-07-01T00:00:00Z'),
      until: new Date('2026-07-31T23:59:59Z'),
    });

    assert.equal(parsed.rowCount, 2);
    assert.equal(parsed.matchedCount, 1);
    assert.equal(parsed.posts.length, 1);
    assert.equal(parsed.nextCursor, 't3_next');
    assert.equal(parsed.profile?.externalId, 't2_k4udmbr');
    assert.equal(parsed.profile?.handle, 'u/bostonglobe');
    assert.equal(parsed.profile?.followers, undefined);
    assert.equal(parsed.profile?.meta?.audienceAvailable, false);
    assert.equal(parsed.posts[0].permalink, 'https://www.reddit.com/r/CambridgeMA/comments/inside/a_boston_story/');
  });

  it('never substitutes mutable Reddit names for missing native ids', () => {
    const created = Date.parse('2026-07-20T12:00:00Z') / 1000;

    assert.throws(
      () => parseRedditPage(response([
        listingPost('community-no-id', created, { subreddit_id: null }),
      ]), {
        handle: 'boston',
        since: new Date('2026-07-01T00:00:00Z'),
        until: new Date('2026-07-31T23:59:59Z'),
      }),
      /without a source-native subreddit id.*mutable subreddit name.*no observations were accepted/i,
    );

    assert.throws(
      () => parseRedditUserPage(response([
        userPost('user-no-id', created, { author_fullname: null }),
      ]), {
        handle: 'bostonglobe',
        since: new Date('2026-07-01T00:00:00Z'),
        until: new Date('2026-07-31T23:59:59Z'),
      }),
      /without a source-native author id.*mutable username.*no observations were accepted/i,
    );
  });
});

describe('Reddit adapter I/O', { concurrency: false }, () => {
  it('requires EnsembleData and never sends a request without a token', async () => {
    const previous = process.env.ENSEMBLEDATA_TOKEN;
    delete process.env.ENSEMBLEDATA_TOKEN;
    try {
      await assert.rejects(
        redditAdapter.fetch(context({ credentials: {} })),
        /sources require an EnsembleData token/,
      );
    } finally {
      if (previous === undefined) delete process.env.ENSEMBLEDATA_TOKEN;
      else process.env.ENSEMBLEDATA_TOKEN = previous;
    }
  });

  it('paginates newest-first, applies the exact window and persists nextCursor', async () => {
    const calls: URL[] = [];
    const created = Date.parse('2026-07-20T12:00:00Z') / 1000;
    await withMockFetch(async (input) => {
      const url = urlOf(input);
      calls.push(url);
      const cursor = url.searchParams.get('cursor');
      if (!cursor) {
        return json(response([
          listingPost('one', created),
          listingPost('future', Date.parse('2026-08-01T00:00:00Z') / 1000),
        ], 'page-2'));
      }
      if (cursor === 'page-2') {
        return json(response([
          listingPost('two', created - 60),
          listingPost('three', created - 120),
        ], 'page-3'));
      }
      throw new Error('Unexpected cursor: ' + cursor);
    }, async () => {
      const result = await redditAdapter.fetch(context({ limit: 2 }));
      assert.deepEqual(result.posts.map((post) => post.externalId), ['one', 'two']);
      assert.equal(result.hasMore, true);
      assert.equal(result.exhaustive, false);
      assert.match(result.incompleteReason ?? '', /resume the saved vendor cursor/i);
      assert.equal(result.cursor?.nextCursor, 'page-3');
      assert.match(result.warnings?.[0] ?? '', /unobserved, not absent/i);
    });

    assert.equal(calls.length, 2);
    assert.equal(calls[0].pathname, '/apis/reddit/subreddit/posts');
    assert.equal(calls[0].searchParams.get('name'), 'boston');
    assert.equal(calls[0].searchParams.get('sort'), 'new');
    assert.equal(calls[0].searchParams.get('period'), 'hour');
    assert.equal(calls[0].searchParams.get('token'), 'test-token');
    assert.equal(calls[1].searchParams.get('cursor'), 'page-2');
  });

  it('does not certify a cursorless vendor feed that stops short of the window', async () => {
    const created = Date.parse('2026-07-20T12:00:00Z') / 1000;
    await withMockFetch(
      async () => json(response([listingPost('one', created)], null)),
      async () => {
        const result = await redditAdapter.fetch(context());
        assert.equal(result.hasMore, false);
        assert.equal(result.exhaustive, false);
        assert.match(result.incompleteReason ?? '', /no continuation cursor/i);
      },
    );
  });

  it('resumes a cursor only for the same subreddit and requested window', async () => {
    const seenCursors: Array<string | null> = [];
    await withMockFetch(async (input) => {
      const url = urlOf(input);
      seenCursors.push(url.searchParams.get('cursor'));
      return json(response([], null));
    }, async () => {
      const base = context();
      await redditAdapter.fetch(context({
        externalId: 't5_2qh3r',
        cursor: {
          subreddit: 'boston',
          windowSince: base.since.toISOString(),
          windowUntil: base.until.toISOString(),
          nextCursor: 'same-window',
        },
      }));
      await redditAdapter.fetch(context({
        externalId: 't5_2qh3r',
        until: new Date('2026-08-01T00:00:00Z'),
        cursor: {
          subreddit: 'boston',
          windowSince: base.since.toISOString(),
          windowUntil: base.until.toISOString(),
          nextCursor: 'stale-window',
        },
      }));
    });

    assert.deepEqual(seenCursors, ['same-window', null]);
  });

  it('keeps an empty feed source-limited when a native identity is already verified', async () => {
    await withMockFetch(async () => json(response([], null)), async () => {
      const result = await redditAdapter.fetch(context({
        handle: 'u/bostonglobe',
        externalId: 't2_k4udmbr',
      }));

      assert.deepEqual(result.posts, []);
      assert.equal(result.profile, undefined);
      assert.equal(result.hasMore, false);
      assert.equal(result.exhaustive, false);
      assert.match(result.incompleteReason ?? '', /unmeasured rather than certified empty/i);
    });
  });

  it('makes an empty identity-unresolved feed retryable instead of binding a username', async () => {
    await withMockFetch(async () => json(response([], null)), async () => {
      await assert.rejects(
        redditAdapter.fetch(context({
          handle: 'u/bostonglobe',
          externalId: null,
        })),
        (error: unknown) => {
          assert.ok(error instanceof Error);
          assert.match(error.message, /no dedicated user-profile endpoint/i);
          assert.match(error.message, /retry/i);
          assert.equal((error as { opts?: { retryable?: boolean } }).opts?.retryable, true);
          return true;
        },
      );
    });
  });

  it('keeps empty profile resolution retryable because the feed is not proof of absence', async () => {
    await withMockFetch(async () => json(response([], null)), async () => {
      await assert.rejects(
        redditAdapter.resolveProfile('u/bostonglobe', {
          ensembleDataToken: 'test-token',
        }),
        (error: unknown) => {
          assert.ok(error instanceof Error);
          assert.match(error.message, /no dedicated user-profile endpoint/i);
          assert.equal((error as { opts?: { retryable?: boolean } }).opts?.retryable, true);
          return true;
        },
      );
    });
  });

  it('resolves a profile from an exact subreddit row', async () => {
    await withMockFetch(async () => json(response([
      listingPost('wrong', Date.now() / 1000, { subreddit: 'cambridge' }),
      listingPost('right', Date.now() / 1000),
    ])), async () => {
      const profile = await redditAdapter.resolveProfile('r/Boston', {
        ensembleDataToken: 'test-token',
      });
      assert.equal(profile.handle, 'boston');
      assert.equal(profile.externalId, 't5_2qh3r');
      assert.equal(profile.followers, 684_321);
      assert.equal(profile.profileUrl, 'https://www.reddit.com/r/boston/');
    });
  });

  it('resolves and paginates the live-shape Reddit user feed', async () => {
    const calls: URL[] = [];
    const created = Date.parse('2026-07-20T12:00:00Z') / 1000;
    await withMockFetch(async (input) => {
      const url = urlOf(input);
      calls.push(url);
      const cursor = url.searchParams.get('cursor');
      if (!cursor) {
        return json(response([
          userPost('one', created),
          userPost('wrong', created, { author: 'not_bostonglobe' }),
        ], 't3_page_2'));
      }
      return json(response([
        userPost('two', created - 60),
      ], 't3_page_3'));
    }, async () => {
      const profile = await redditAdapter.resolveProfile('u/BostonGlobe', {
        ensembleDataToken: 'test-token',
      });
      assert.equal(profile.handle, 'u/bostonglobe');
      assert.equal(profile.externalId, 't2_k4udmbr');
      assert.equal(profile.followers, undefined);

      const result = await redditAdapter.fetch(context({
        handle: 'u/bostonglobe',
        externalId: 't2_k4udmbr',
        limit: 2,
      }));
      assert.deepEqual(result.posts.map((post) => post.externalId), ['one', 'two']);
      assert.deepEqual(result.audience, []);
      assert.equal(result.profile?.handle, 'u/bostonglobe');
      assert.equal(result.cursor?.source, 'ensembledata');
      assert.equal(result.cursor?.redditEntityType, 'user');
      assert.equal(result.cursor?.nextCursor, 't3_page_3');
      assert.equal(result.hasMore, true);
      assert.equal(result.exhaustive, false);
      assert.match(result.incompleteReason ?? '', /resume the saved vendor cursor/i);
    });

    assert.equal(calls[0].pathname, '/apis/reddit/user/posts');
    assert.equal(calls[0].searchParams.get('name'), 'bostonglobe');
    assert.equal(calls[0].searchParams.get('period'), 'all');
    assert.equal(calls[0].searchParams.get('token'), 'test-token');
    assert.equal(calls.at(-1)?.searchParams.get('cursor'), 't3_page_2');
  });
});
