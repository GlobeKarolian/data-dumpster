/**
 * GET /api/leakage/story?url=<our story URL>&terms=Last%20Ditch,Greenfield&maxPosts=300
 *
 * Who is sharing one of our stories on X in the last seven days, and how:
 * direct links, archive or paywall-bypass copies, replies, quotes. Admin only,
 * because every returned post is a paid X read. The Bearer token never leaves
 * the server. Query logic and classification live in lib/leakage.
 */
import type { NextRequest } from 'next/server';
import { apiHandler, HttpError, requireRole } from '@/lib/session';
import {
  buildShareQueries,
  linkKind,
  parseStoryUrl,
  placement,
  type XUrlEntity,
} from '@/lib/leakage/story-shares';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 120;

const X_API = 'https://api.x.com/2';
const MAX_POSTS_CAP = 1000;

interface XUser {
  id: string;
  username: string;
  name: string;
  created_at?: string;
  description?: string;
  verified?: boolean;
  verified_type?: string;
  public_metrics?: { followers_count?: number };
}

interface XTweet {
  id: string;
  text: string;
  author_id: string;
  created_at?: string;
  referenced_tweets?: Array<{ type: string; id: string }>;
  entities?: { urls?: XUrlEntity[] };
  public_metrics?: {
    like_count?: number;
    retweet_count?: number;
    reply_count?: number;
    quote_count?: number;
    impression_count?: number;
  };
}

async function x<T>(path: string, params: Record<string, string>, bearer: string): Promise<T> {
  const response = await fetch(X_API + path + '?' + new URLSearchParams(params).toString(), {
    headers: { authorization: 'Bearer ' + bearer },
    cache: 'no-store',
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    const detail = (body as { detail?: string; title?: string }).detail ?? (body as { title?: string }).title;
    throw new HttpError(502, 'X API ' + response.status + (detail ? ': ' + detail : ''), 'x_api_error');
  }
  return body as T;
}

export const GET = apiHandler(async (req: NextRequest) => {
  await requireRole('admin');
  const bearer = process.env.TWITTER_BEARER_TOKEN?.trim();
  if (!bearer) throw new HttpError(503, 'TWITTER_BEARER_TOKEN is not configured.', 'x_unconfigured');

  const params = req.nextUrl.searchParams;
  let story;
  try {
    story = parseStoryUrl(params.get('url') ?? '');
  } catch (error) {
    throw new HttpError(400, error instanceof Error ? error.message : 'Bad story URL.');
  }
  const terms = (params.get('terms') ?? '').split(',').map((t) => t.trim()).filter(Boolean);
  const maxPosts = Math.min(MAX_POSTS_CAP, Math.max(10, Number(params.get('maxPosts')) || 300));
  const queries = buildShareQueries(story, terms);

  const tweets = new Map<string, XTweet & { matchedBy: string }>();
  const users = new Map<string, XUser>();
  const counts: Array<{
    id: string; label: string; query: string; totalLast7Days: number | null; read: number;
    countError?: string; searchMeta?: unknown; searchErrors?: unknown;
  }> = [];
  const readIds = new Set(params.get('read')?.split(',').filter(Boolean) ?? ['direct', 'slug', 'bypass']);

  for (const q of queries) {
    let total: number | null = null;
    let countError: string | undefined;
    try {
      const c = await x<{ meta?: { total_tweet_count?: number } }>(
        '/tweets/counts/recent', { query: q.query, granularity: 'day' }, bearer,
      );
      total = c.meta?.total_tweet_count ?? null;
    } catch (error) {
      total = null; // Counts are a sizing aid; a plan without them still reads.
      countError = error instanceof Error ? error.message : String(error);
    }
    let read = 0;
    let nextToken: string | undefined;
    let searchMeta: unknown;
    let searchErrors: unknown;
    while (readIds.has(q.id) && tweets.size < maxPosts) {
      const page = await x<{
        data?: XTweet[];
        includes?: { users?: XUser[] };
        meta?: { next_token?: string };
        errors?: unknown;
      }>('/tweets/search/recent', {
        query: q.query,
        max_results: String(Math.min(100, Math.max(10, maxPosts - tweets.size))),
        'tweet.fields': 'created_at,public_metrics,referenced_tweets,entities,author_id',
        expansions: 'author_id',
        'user.fields': 'username,name,created_at,description,public_metrics,verified,verified_type',
        ...(nextToken ? { next_token: nextToken } : {}),
      }, bearer);
      for (const user of page.includes?.users ?? []) users.set(user.id, user);
      for (const tweet of page.data ?? []) {
        read += 1;
        if (!tweets.has(tweet.id)) tweets.set(tweet.id, { ...tweet, matchedBy: q.id });
      }
      searchMeta = page.meta;
      searchErrors = page.errors;
      nextToken = page.meta?.next_token;
      if (!nextToken || (page.data ?? []).length === 0) break;
    }
    counts.push({
      id: q.id, label: q.label, query: q.query, totalLast7Days: total, read,
      ...(countError ? { countError } : {}),
      ...(searchMeta !== undefined ? { searchMeta } : {}),
      ...(searchErrors !== undefined ? { searchErrors } : {}),
    });
  }

  const posts = [...tweets.values()].map((tweet) => {
    const author = users.get(tweet.author_id);
    const link = linkKind(story, tweet.entities?.urls ?? []);
    return {
      url: 'https://x.com/' + (author?.username ?? 'i') + '/status/' + tweet.id,
      createdAt: tweet.created_at ?? null,
      author: author?.username ?? tweet.author_id,
      followers: author?.public_metrics?.followers_count ?? 0,
      placement: placement(tweet.referenced_tweets),
      link: link.kind,
      tool: link.tool ?? null,
      likes: tweet.public_metrics?.like_count ?? 0,
      reposts: tweet.public_metrics?.retweet_count ?? 0,
      quotes: tweet.public_metrics?.quote_count ?? 0,
      replies: tweet.public_metrics?.reply_count ?? 0,
      views: tweet.public_metrics?.impression_count ?? 0,
      text: tweet.text.slice(0, 280),
    };
  }).sort((a, b) => b.followers - a.followers);

  const byAccount = new Map<string, { posts: number; followers: number }>();
  for (const post of posts) {
    const current = byAccount.get(post.author) ?? { posts: 0, followers: post.followers };
    current.posts += 1;
    byAccount.set(post.author, current);
  }
  const tally = <K extends string>(pick: (p: (typeof posts)[number]) => K) =>
    posts.reduce<Record<string, number>>((acc, p) => { acc[pick(p)] = (acc[pick(p)] ?? 0) + 1; return acc; }, {});

  const accounts = [...byAccount.entries()].map(([username, a]) => {
    const user = [...users.values()].find((u) => u.username === username);
    return {
      username,
      name: user?.name ?? null,
      followers: a.followers,
      posts: a.posts,
      accountCreated: user?.created_at ?? null,
      verified: user?.verified_type ?? (user?.verified ? 'verified' : null),
      bio: (user?.description ?? '').slice(0, 160),
    };
  }).sort((a, b) => b.followers - a.followers);

  return Response.json({
    story: story.key,
    window: 'last 7 days (X recent search)',
    queries: counts,
    summary: {
      posts: posts.length,
      distinctAccounts: accounts.length,
      combinedFollowers: accounts.reduce((sum, a) => sum + a.followers, 0),
      views: posts.reduce((sum, p) => sum + p.views, 0),
      reposts: posts.reduce((sum, p) => sum + p.reposts, 0),
      byPlacement: tally((p) => p.placement),
      byLink: tally((p) => (p.tool ? 'bypass:' + p.tool : p.link)),
      capped: posts.length >= maxPosts,
    },
    accounts,
    posts,
  }, { headers: { 'cache-control': 'no-store' } });
});
