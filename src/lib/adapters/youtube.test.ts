import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { FetchContext } from './types';
import { youtubeAdapter } from './youtube';

const CHANNEL_ID = 'UC1234567890123456789012';
const UPLOADS_PLAYLIST_ID = 'UU1234567890123456789012';
const WINDOW = {
  since: new Date('2026-07-01T00:00:00Z'),
  until: new Date('2026-07-31T23:59:59Z'),
};

function context(overrides: Partial<FetchContext> = {}): FetchContext {
  return {
    handle: 'mets',
    externalId: CHANNEL_ID,
    cursor: {},
    ...WINDOW,
    credentials: { apiKey: 'test-key' },
    limit: 500,
    ...overrides,
  };
}

function json(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}

function urlOf(input: Parameters<typeof fetch>[0]): URL {
  if (typeof input === 'string') return new URL(input);
  if (input instanceof URL) return input;
  return new URL(input.url);
}

function channelResponse(): Record<string, unknown> {
  return {
    items: [{
      id: CHANNEL_ID,
      snippet: {
        title: 'New York Mets',
        customUrl: '@mets',
        thumbnails: { high: { url: 'https://example.com/mets.jpg' } },
      },
      statistics: {
        subscriberCount: '1000000',
        viewCount: '2000000',
        videoCount: '512',
      },
      contentDetails: {
        relatedPlaylists: { uploads: UPLOADS_PLAYLIST_ID },
      },
    }],
  };
}

function uploadItem(index: number): Record<string, unknown> {
  return {
    contentDetails: {
      videoId: `video-${index}`,
      videoPublishedAt: new Date(Date.parse('2026-07-30T12:00:00Z') - index * 60_000).toISOString(),
    },
  };
}

function videoItem(id: string): Record<string, unknown> {
  const index = Number(id.slice('video-'.length));
  return {
    id,
    snippet: {
      title: `Video ${index}`,
      description: '',
      publishedAt: new Date(Date.parse('2026-07-30T12:00:00Z') - index * 60_000).toISOString(),
      thumbnails: { high: { url: `https://example.com/${id}.jpg` } },
    },
    statistics: { viewCount: '100', likeCount: '10', commentCount: '1' },
    contentDetails: { duration: 'PT1M' },
  };
}

async function withMockFetch<T>(mock: typeof fetch, run: () => Promise<T>): Promise<T> {
  const original = globalThis.fetch;
  globalThis.fetch = mock;
  try {
    return await run();
  } finally {
    globalThis.fetch = original;
  }
}

describe('YouTube uploads pagination', { concurrency: false }, () => {
  it('resumes after 500 videos and clears the page token when the window is complete', async () => {
    const playlistTokens: Array<string | null> = [];

    await withMockFetch(async (input) => {
      const url = urlOf(input);
      if (url.pathname.endsWith('/channels')) return json(channelResponse());

      if (url.pathname.endsWith('/playlistItems')) {
        const token = url.searchParams.get('pageToken');
        playlistTokens.push(token);
        const page = token ? Number(token.slice('page-'.length)) : 1;
        const start = (page - 1) * 50 + 1;
        const count = page <= 10 ? 50 : 12;
        return json({
          items: Array.from({ length: count }, (_, offset) => uploadItem(start + offset)),
          ...(page <= 10 ? { nextPageToken: `page-${page + 1}` } : {}),
        });
      }

      if (url.pathname.endsWith('/videos')) {
        const ids = (url.searchParams.get('id') ?? '').split(',').filter(Boolean);
        return json({ items: ids.map(videoItem) });
      }

      throw new Error(`Unexpected YouTube endpoint: ${url.pathname}`);
    }, async () => {
      const first = await youtubeAdapter.fetch(context());
      assert.equal(first.posts.length, 500);
      assert.equal(first.hasMore, true);
      assert.equal(first.cursor?.nextPageToken, 'page-11');
      assert.equal(first.cursor?.nextCursor, 'page-11');

      const second = await youtubeAdapter.fetch(context({ cursor: first.cursor }));
      assert.equal(second.posts.length, 12);
      assert.equal(second.posts[0]?.externalId, 'video-501');
      assert.equal(second.hasMore, false);
      assert.equal(second.cursor?.nextPageToken, null);
      assert.equal(second.cursor?.nextCursor, null);
    });

    assert.deepEqual(playlistTokens, [
      null,
      'page-2',
      'page-3',
      'page-4',
      'page-5',
      'page-6',
      'page-7',
      'page-8',
      'page-9',
      'page-10',
      'page-11',
    ]);
  });
});
