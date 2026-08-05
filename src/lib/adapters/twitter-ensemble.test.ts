import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  parseTwitterProfile,
  parseTwitterTweets,
} from './twitter-ensemble';
import {
  twitterAdapter,
  twitterSourceOrder,
} from './twitter';
import { fetchProfilePosts as fetchTwitterBrightDataPosts } from './twitter-brightdata';
import { DATASETS } from '@/lib/vendors/brightdata';
import type { FetchContext } from './types';

function timelineRow(
  id: string,
  createdAt: string,
  overrides: Record<string, unknown> = {},
  component = 'profile_best_highlights',
): Record<string, unknown> {
  return {
    content: {
      clientEventInfo: { component },
      itemContent: {
        tweet_results: {
          result: {
            __typename: 'Tweet',
            rest_id: id,
            legacy: {
              id_str: id,
              created_at: createdAt,
              full_text: 'A story about #RedSox from @BostonGlobe https://t.co/story',
              favorite_count: 100,
              reply_count: 4,
              retweet_count: 5,
              quote_count: 2,
              bookmark_count: 3,
              lang: 'en',
              is_quote_status: false,
              entities: {
                hashtags: [{ text: 'RedSox' }],
                user_mentions: [{ screen_name: 'BostonGlobe' }],
                urls: [
                  { expanded_url: 'https://www.bostonglobe.com/story' },
                  { expanded_url: 'https://x.com/BostonGlobe/status/' + id },
                ],
              },
              extended_entities: {
                media: [{
                  type: 'video',
                  media_url_https: 'https://pbs.twimg.com/video_thumb.jpg',
                  video_info: {
                    duration_millis: 19_300,
                    variants: [
                      { bitrate: 632_000, content_type: 'video/mp4', url: 'https://video.twimg.com/low.mp4' },
                      { bitrate: 2_176_000, content_type: 'video/mp4', url: 'https://video.twimg.com/high.mp4' },
                    ],
                  },
                }],
              },
              ...overrides,
            },
            views: { count: '900', state: 'EnabledWithCount' },
          },
        },
      },
    },
  };
}

function context(overrides: Partial<FetchContext> = {}): FetchContext {
  return {
    handle: 'BostonGlobe',
    externalId: null,
    cursor: {},
    since: new Date('2026-07-01T00:00:00Z'),
    until: new Date('2026-07-29T23:59:59Z'),
    credentials: {},
    limit: 10,
    ...overrides,
  };
}

function ensembleProfile(): Record<string, unknown> {
  return {
    data: {
      rest_id: '95431448',
      legacy: {
        screen_name: 'BostonGlobe',
        name: 'The Boston Globe',
        followers_count: 769_679,
        friends_count: 931,
      },
    },
  };
}

function xProfile(): Record<string, unknown> {
  return {
    data: {
      id: '95431448',
      username: 'BostonGlobe',
      name: 'The Boston Globe',
      public_metrics: {
        followers_count: 769_679,
        following_count: 931,
        tweet_count: 605_900,
        listed_count: 9_551,
      },
    },
  };
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function urlOf(input: Parameters<typeof fetch>[0]): string {
  if (typeof input === 'string') return input;
  if (input instanceof URL) return input.toString();
  return input.url;
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

describe('EnsembleData X response parsing', () => {
  it('maps the observed profile shape and latest audience stock', () => {
    const result = parseTwitterProfile({
      data: {
        rest_id: '95431448',
        is_blue_verified: true,
        legacy: {
          screen_name: 'BostonGlobe',
          name: 'The Boston Globe',
          profile_image_url_https: 'https://pbs.twimg.com/avatar_normal.jpg',
          followers_count: 769_679,
          friends_count: 931,
          statuses_count: 605_900,
          listed_count: 9_551,
        },
      },
    }, 'BostonGlobe');

    assert.equal(result.profile.externalId, '95431448');
    assert.equal(result.profile.handle, 'BostonGlobe');
    assert.equal(result.profile.avatarUrl, 'https://pbs.twimg.com/avatar.jpg');
    assert.equal(result.profile.followers, 769_679);
    assert.equal(result.audience?.followers, 769_679);
    assert.equal(result.audience?.following, 931);
    assert.equal(result.audience?.extra?.postCount, 605_900);
  });

  it('maps engagement and media while filtering the requested window and reposts', () => {
    const result = parseTwitterTweets({
      data: [
        timelineRow('200', 'Tue Jul 28 12:00:00 +0000 2026'),
        timelineRow('100', 'Tue Jul 01 12:00:00 +0000 2025'),
        timelineRow('201', 'Tue Jul 28 13:00:00 +0000 2026', {
          full_text: 'RT @someone: their story',
        }),
      ],
    }, 'BostonGlobe', {
      since: new Date('2026-07-01T00:00:00Z'),
      until: new Date('2026-07-29T23:59:59Z'),
      limit: 10,
    });

    assert.equal(result.posts.length, 1);
    const post = result.posts[0];
    assert.equal(post.externalId, '200');
    assert.equal(post.type, 'video');
    assert.equal(post.applause, 100);
    assert.equal(post.conversation, 4);
    assert.equal(post.amplification, 7);
    assert.equal(post.saves, 3);
    assert.equal(post.views, 900);
    assert.equal(post.durationSec, 19);
    assert.equal(post.mediaUrl, 'https://video.twimg.com/high.mp4');
    assert.deepEqual(post.urls, ['https://www.bostonglobe.com/story']);
    assert.deepEqual(post.hashtags, ['redsox']);
    assert.deepEqual(post.mentions, ['bostonglobe']);
  });

  it('warns that the observed highlights feed is not a complete timeline', () => {
    const result = parseTwitterTweets({
      data: [timelineRow('200', 'Tue Jul 28 12:00:00 +0000 2026')],
    }, 'BostonGlobe', {
      since: new Date('2026-07-01T00:00:00Z'),
      until: new Date('2026-07-29T23:59:59Z'),
      limit: 10,
    });

    assert.match(result.warnings[0], /profile highlights, not a chronological timeline/i);
    assert.match(result.warnings[0], /missing rather than absent/i);
  });
});

describe('X source routing and failover', { concurrency: false }, () => {
  it('orders sources by channel ownership', () => {
    assert.deepEqual(twitterSourceOrder({
      owned: true,
      hasBearer: true,
      hasEnsemble: true,
      hasBrightData: true,
    }), ['x-api-v2', 'brightdata']);

    assert.deepEqual(twitterSourceOrder({
      owned: false,
      hasBearer: true,
      hasEnsemble: true,
      hasBrightData: true,
    }), ['brightdata']);

    assert.deepEqual(twitterSourceOrder({
      owned: false,
      hasBearer: false,
      hasEnsemble: true,
      hasBrightData: false,
    }), ['ensembledata']);

    assert.deepEqual(twitterSourceOrder({
      owned: false,
      hasBearer: true,
      hasEnsemble: false,
      hasBrightData: false,
    }), []);
  });

  it('ignores Bearer and EnsembleData and uses Bright Data for public collection', async () => {
    const calls: string[] = [];
    await withMockFetch(async (input) => {
      const url = urlOf(input);
      calls.push(url);
      if (url.startsWith('https://api.brightdata.com/')) {
        return json([{
          user_id: '95431448',
          user_posted: 'BostonGlobe',
          followers: 769_679,
          id: 'bright-post-1',
          date_posted: '2026-07-28T12:00:00Z',
          description: 'A story',
        }]);
      }
      throw new Error('Unexpected source: ' + url);
    }, async () => {
      const result = await twitterAdapter.fetch(context({
        cursor: { __isOwned: false },
        credentials: {
          bearerToken: 'bearer',
          ensembleDataToken: 'ensemble',
          brightDataApiKey: 'bright',
        },
      }));
      assert.equal(result.cursor?.source, 'brightdata');
      assert.equal(result.hasMore, false);
      assert.equal(result.exhaustive, false);
    });

    assert.equal(calls.length, 1);
    assert.ok(calls[0].startsWith('https://api.brightdata.com/'));
    assert.ok(calls.every((url) => url.startsWith('https://api.brightdata.com/')));
  });

  it('uses EnsembleData for public collection when Bright Data is absent', async () => {
    const calls: string[] = [];
    await withMockFetch(async (input) => {
      const url = urlOf(input);
      calls.push(url);
      if (url.includes('/twitter/user/info')) return json(ensembleProfile());
      if (url.includes('/twitter/user/tweets')) return json({ data: [] });
      throw new Error('Unexpected source: ' + url);
    }, async () => {
      const result = await twitterAdapter.fetch(context({
        cursor: { __isOwned: false },
        credentials: { ensembleDataToken: 'ensemble' },
      }));
      assert.equal(result.cursor?.source, 'ensembledata');
      assert.equal(result.exhaustive, false);
    });

    assert.equal(calls.length, 2);
    assert.ok(calls.every((url) => url.startsWith('https://ensembledata.com/')));
  });

  it('uses the Bearer token first for an owned channel', async () => {
    const calls: string[] = [];
    await withMockFetch(async (input) => {
      const url = urlOf(input);
      calls.push(url);
      if (url.includes('/users/by/username/BostonGlobe')) return json(xProfile());
      if (url.includes('/users/95431448/tweets')) return json({ data: [], meta: {} });
      throw new Error('Unexpected source: ' + url);
    }, async () => {
      const result = await twitterAdapter.fetch(context({
        cursor: { __isOwned: true },
        credentials: {
          bearerToken: 'bearer',
          selfUserId: '95431448',
          ensembleDataToken: 'ensemble',
          brightDataApiKey: 'bright',
        },
      }));
      assert.equal(result.cursor?.source, 'x-api-v2');
      assert.equal(result.hasMore, false);
      assert.equal(result.exhaustive, true);
    });

    assert.equal(calls.length, 2);
    assert.ok(calls.every((url) => url.startsWith('https://api.x.com/')));
  });

  it('does not advertise a continuation when the X pagination token is not persisted', async () => {
    await withMockFetch(async (input) => {
      const url = urlOf(input);
      if (url.includes('/users/by/username/BostonGlobe')) return json(xProfile());
      if (url.includes('/users/95431448/tweets')) {
        return json({
          data: Array.from({ length: 5 }, (_, index) => ({
            id: String(10_000 - index),
            created_at: `2026-07-2${8 - index}T12:00:00Z`,
            text: 'A story',
            public_metrics: {},
          })),
          meta: { next_token: 'not-persisted' },
        });
      }
      throw new Error('Unexpected source: ' + url);
    }, async () => {
      const result = await twitterAdapter.fetch(context({
        cursor: { __isOwned: true },
        credentials: { bearerToken: 'bearer', selfUserId: '95431448' },
        limit: 5,
      }));
      assert.equal(result.posts.length, 5);
      assert.equal(result.hasMore, false);
      assert.equal(result.exhaustive, false);
      assert.match(result.incompleteReason ?? '', /without a persisted pagination token/i);
      assert.equal(result.cursor?.newestTweetId, null);
    });
  });

  it('does not fall back to EnsembleData after a Bright Data stage fails', async () => {
    const calls: string[] = [];
    await withMockFetch(async (input) => {
      const url = urlOf(input);
      calls.push(url);
      if (url.includes('/twitter/user/info')) {
        throw new Error('EnsembleData must not be called after a Bright Data failure.');
      }
      if (url.startsWith('https://api.brightdata.com/')) {
        return json({ error: 'snapshot failed' }, 401);
      }
      throw new Error('Unexpected source: ' + url);
    }, async () => {
      await assert.rejects(
        twitterAdapter.fetch(context({
          cursor: { __isOwned: false },
          credentials: {
            bearerToken: 'bearer',
            ensembleDataToken: 'ensemble',
            brightDataApiKey: 'bright',
          },
        })),
        /Every configured X source failed.*Bright Data/i,
      );
    });

    assert.ok(calls.length > 0);
    assert.ok(calls.every((url) => url.startsWith('https://api.brightdata.com/')));
  });

  it('resumes a saved Bright Data receipt before trying EnsembleData again', async () => {
    const calls: string[] = [];
    const base = context();
    await withMockFetch(async (input) => {
      const url = urlOf(input);
      calls.push(url);
      if (url.includes('/progress/sd_saved_x')) return json({ status: 'ready' });
      if (url.includes('/snapshot/sd_saved_x')) {
        return json([{
          user_id: '95431448',
          user_posted: 'BostonGlobe',
          followers: 769_679,
          id: 'bright-post-resumed',
          date_posted: '2026-07-28T12:00:00Z',
          description: 'A resumed story',
        }]);
      }
      throw new Error('Unexpected source: ' + url);
    }, async () => {
      const result = await twitterAdapter.fetch(context({
        externalId: '95431448',
        cursor: {
          __isOwned: false,
          source: 'brightdata',
          brightDataStage: 'twitter-posts',
          brightDataDatasetId: DATASETS.twitterPosts,
          pendingSnapshotId: 'sd_saved_x',
          pendingSince: new Date().toISOString(),
          nextCursor: 'sd_saved_x',
          windowSince: base.since.toISOString(),
          windowUntil: base.until.toISOString(),
        },
        credentials: {
          ensembleDataToken: 'ensemble',
          brightDataApiKey: 'bright',
        },
      }));
      assert.equal(result.cursor?.source, 'brightdata');
      assert.equal(result.cursor?.pendingSnapshotId, null);
      assert.equal(result.posts.length, 1);
    });

    assert.ok(calls.some((url) => url.includes('/progress/sd_saved_x')));
    assert.ok(calls.some((url) => url.includes('/snapshot/sd_saved_x')));
    assert.ok(calls.every((url) => url.startsWith('https://api.brightdata.com/')));
    assert.ok(calls.every((url) => !url.includes('/scrape?')));
  });

  it('treats a verified X profile with no vendor posts as limited, not broken', async () => {
    await withMockFetch(async (input) => {
      const url = urlOf(input);
      if (url.includes('/twitter/user/info')) {
        return json({ detail: 'daily quota exhausted' }, 495);
      }
      if (url.startsWith('https://api.brightdata.com/')) {
        return json([{
          error: 'No public posts were found in the profile for the specified period.',
          error_code: 'dead_page',
        }]);
      }
      throw new Error('Unexpected source: ' + url);
    }, async () => {
      const result = await twitterAdapter.fetch(context({
        externalId: '95431448',
        cursor: { __isOwned: false },
        credentials: {
          ensembleDataToken: 'ensemble',
          brightDataApiKey: 'bright',
        },
      }));

      assert.equal(result.profile?.externalId, '95431448');
      assert.equal(result.posts.length, 0);
      assert.equal(result.exhaustive, false);
      assert.match(result.incompleteReason ?? '', /cannot certify.*inactive/i);
    });
  });

  it('never falls back to EnsembleData or Bearer when Bright Data fails', async () => {
    const calls: string[] = [];
    await withMockFetch(async (input) => {
      const url = urlOf(input);
      calls.push(url);
      if (url.includes('/twitter/user/info')) {
        throw new Error('EnsembleData must not be called after a Bright Data failure.');
      }
      if (url.startsWith('https://api.brightdata.com/')) {
        return json([{ error: 'profile unavailable' }]);
      }
      throw new Error('Unexpected source: ' + url);
    }, async () => {
      await assert.rejects(
        twitterAdapter.fetch(context({
          cursor: { __isOwned: false },
          credentials: {
            bearerToken: 'bearer',
            selfUserId: '95431448',
            ensembleDataToken: 'ensemble',
            brightDataApiKey: 'bright',
          },
        })),
        /every configured X source failed/i,
      );
    });

    const hosts = calls.map((url) => new URL(url).hostname);
    assert.deepEqual(hosts, ['api.brightdata.com']);
  });

  it('rejects Bearer-only public collection without making an X API call', async () => {
    let calls = 0;
    await withMockFetch(async () => {
      calls += 1;
      throw new Error('No source request was expected.');
    }, async () => {
      await assert.rejects(
        twitterAdapter.fetch(context({
          cursor: { __isOwned: false },
          credentials: { bearerToken: 'bearer', selfUserId: '95431448' },
        })),
        /public X collection requires an EnsembleData token or a Bright Data API key/i,
      );
    });
    assert.equal(calls, 0);
  });

  it('does not try another paid source after caller cancellation', async () => {
    const controller = new AbortController();
    const calls: string[] = [];

    await withMockFetch(async (input) => {
      calls.push(urlOf(input));
      controller.abort();
      throw new DOMException('Aborted', 'AbortError');
    }, async () => {
      await assert.rejects(
        twitterAdapter.fetch(context({
          cursor: { __isOwned: false },
          credentials: {
            bearerToken: 'bearer',
            ensembleDataToken: 'ensemble',
            brightDataApiKey: 'bright',
          },
          signal: controller.signal,
        })),
        /cancelled|aborted/i,
      );
    });

    assert.equal(calls.length, 1);
    assert.ok(calls[0].startsWith('https://api.brightdata.com/'));
  });

  it('prefers EnsembleData for profile resolution when Bearer is also configured', async () => {
    const calls: string[] = [];
    await withMockFetch(async (input) => {
      const url = urlOf(input);
      calls.push(url);
      if (url.includes('/twitter/user/info')) return json(ensembleProfile());
      throw new Error('Unexpected source: ' + url);
    }, async () => {
      const profile = await twitterAdapter.resolveProfile('BostonGlobe', {
        bearerToken: 'bearer',
        ensembleDataToken: 'ensemble',
      });
      assert.equal(profile.externalId, '95431448');
    });

    assert.equal(calls.length, 1);
    assert.ok(calls[0].startsWith('https://ensembledata.com/'));
  });

  it('makes Bright-Data-only onboarding explicitly unavailable without buying a posts crawl', async () => {
    let calls = 0;
    await withMockFetch(async () => {
      calls += 1;
      throw new Error('No source request was expected.');
    }, async () => {
      await assert.rejects(
        twitterAdapter.resolveProfile('BostonGlobe', {
          ensembleDataToken: '',
          brightDataApiKey: 'bright',
        }),
        /no separate receipt-preserving profile lookup.*Configure EnsembleData.*existing verified channel/i,
      );
    });
    assert.equal(calls, 0);
  });

  it('does not fabricate an X platform id from the handle', async () => {
    await withMockFetch(async () => json([{
      user_posted: 'BostonGlobe',
      id: 'post-without-author-id',
      date_posted: '2026-07-28T12:00:00Z',
      description: 'A story',
    }]), async () => {
      await assert.rejects(
        fetchTwitterBrightDataPosts('BostonGlobe', 'bright', {
          since: new Date('2026-07-01T00:00:00Z'),
          until: new Date('2026-07-29T23:59:59Z'),
          limit: 10,
        }),
        /without a stable platform id.*No observations were accepted/i,
      );
    });
  });
});
