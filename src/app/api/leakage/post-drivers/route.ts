/**
 * GET /api/leakage/post-drivers?post=<x.com status URL or id>&maxQuotes=500&maxReposters=300&maxReplies=200
 *
 * What drove one X post's reach: its own metrics, every quote post (with that
 * quote's own views and its author), the accounts that reposted it, and the
 * replies (last seven days). Named users only; every item is a paid X read.
 */
import type { NextRequest } from 'next/server';
import { apiHandler, HttpError } from '@/lib/session';
import { requireLeakageUser } from '@/lib/leakage/guard';
import { parseTweetId, topShare, type DriverAccount, type QuoteDriver } from '@/lib/leakage/post-drivers';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

const X_API = 'https://api.x.com/2';
const USER_FIELDS = 'username,name,public_metrics,verified,verified_type,description';
const TWEET_FIELDS = 'created_at,public_metrics,author_id,conversation_id';

interface XUser { id: string; username: string; name: string; description?: string; verified?: boolean; verified_type?: string; public_metrics?: { followers_count?: number } }
type UserPage = { data?: XUser[]; meta?: { next_token?: string } };
type TweetPage = { data?: XTweet[]; includes?: { users?: XUser[] }; meta?: { next_token?: string } };

interface XTweet { id: string; text: string; author_id: string; created_at?: string; public_metrics?: { impression_count?: number; like_count?: number; retweet_count?: number; reply_count?: number; quote_count?: number; bookmark_count?: number } }

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

function account(user: XUser | undefined, fallbackId: string): DriverAccount {
  return {
    username: user?.username ?? fallbackId,
    name: user?.name ?? null,
    followers: user?.public_metrics?.followers_count ?? 0,
    verified: user?.verified_type ?? (user?.verified ? 'verified' : null),
    bio: (user?.description ?? '').slice(0, 160),
  };
}

export const GET = apiHandler(async (req: NextRequest) => {
  await requireLeakageUser();
  const bearer = process.env.TWITTER_BEARER_TOKEN?.trim();
  if (!bearer) throw new HttpError(503, 'TWITTER_BEARER_TOKEN is not configured.', 'x_unconfigured');
  const params = req.nextUrl.searchParams;
  const id = parseTweetId(params.get('post') ?? '');
  if (!id) throw new HttpError(400, 'Give an x.com post link or id.');
  const cap = (key: string, fallback: number, max: number) => Math.min(max, Math.max(0, Number(params.get(key)) || fallback));
  const maxQuotes = cap('maxQuotes', 500, 5000);
  const maxReposters = cap('maxReposters', 300, 1000);
  const maxReplies = cap('maxReplies', 200, 1000);

  const post = await x<{ data?: XTweet; includes?: { users?: XUser[] } }>('/tweets/' + id, {
    'tweet.fields': TWEET_FIELDS, expansions: 'author_id', 'user.fields': USER_FIELDS,
  }, bearer);
  if (!post.data) throw new HttpError(404, 'X returned no post for that id.');

  const quotes: QuoteDriver[] = [];
  let token: string | undefined;
  // The quote_tweets endpoint pages newest-first under a tight rate limit, so
  // the earliest quotes can be out of reach. With a window, recent search's
  // quotes_of_tweet_id operator reads just that slice (last seven days only).
  const windowStart = params.get('quotesFrom');
  const windowEnd = params.get('quotesTo');
  const viaSearch = Boolean(windowStart || windowEnd);
  while (quotes.length < maxQuotes) {
    const page: TweetPage = viaSearch
      ? await x<TweetPage>('/tweets/search/recent', {
        query: 'quotes_of_tweet_id:' + id,
        max_results: String(Math.min(100, Math.max(10, maxQuotes - quotes.length))),
        ...(windowStart ? { start_time: new Date(windowStart).toISOString() } : {}),
        ...(windowEnd ? { end_time: new Date(windowEnd).toISOString() } : {}),
        'tweet.fields': TWEET_FIELDS, expansions: 'author_id', 'user.fields': USER_FIELDS,
        ...(token ? { next_token: token } : {}),
      }, bearer)
      : await x<TweetPage>('/tweets/' + id + '/quote_tweets', {
        max_results: String(Math.min(100, Math.max(10, maxQuotes - quotes.length))),
        'tweet.fields': TWEET_FIELDS, expansions: 'author_id', 'user.fields': USER_FIELDS,
        ...(token ? { pagination_token: token } : {}),
      }, bearer);
    const users = new Map((page.includes?.users ?? []).map((u) => [u.id, u]));
    for (const t of page.data ?? []) {
      const who = account(users.get(t.author_id), t.author_id);
      quotes.push({
        ...who,
        url: 'https://x.com/' + who.username + '/status/' + t.id,
        createdAt: t.created_at ?? null,
        views: t.public_metrics?.impression_count ?? 0,
        likes: t.public_metrics?.like_count ?? 0,
        reposts: t.public_metrics?.retweet_count ?? 0,
        text: t.text.slice(0, 280),
      });
    }
    token = page.meta?.next_token;
    if (!token || (page.data ?? []).length === 0) break;
  }

  const reposters: DriverAccount[] = [];
  token = undefined;
  while (maxReposters > 0 && reposters.length < maxReposters) {
    const page: UserPage = await x<UserPage>('/tweets/' + id + '/retweeted_by', {
      max_results: String(Math.min(100, Math.max(1, maxReposters - reposters.length))),
      'user.fields': USER_FIELDS,
      ...(token ? { pagination_token: token } : {}),
    }, bearer);
    for (const u of page.data ?? []) reposters.push(account(u, u.id));
    token = page.meta?.next_token;
    if (!token || (page.data ?? []).length === 0) break;
  }

  const replies: QuoteDriver[] = [];
  token = undefined;
  while (maxReplies > 0 && replies.length < maxReplies) {
    const page: TweetPage = await x<TweetPage>('/tweets/search/recent', {
      query: 'conversation_id:' + id + ' is:reply',
      max_results: String(Math.min(100, Math.max(10, maxReplies - replies.length))),
      'tweet.fields': TWEET_FIELDS, expansions: 'author_id', 'user.fields': USER_FIELDS,
      ...(token ? { next_token: token } : {}),
    }, bearer);
    const users = new Map((page.includes?.users ?? []).map((u) => [u.id, u]));
    for (const t of page.data ?? []) {
      const who = account(users.get(t.author_id), t.author_id);
      replies.push({ ...who, url: 'https://x.com/' + who.username + '/status/' + t.id, createdAt: t.created_at ?? null, views: t.public_metrics?.impression_count ?? 0, likes: t.public_metrics?.like_count ?? 0, reposts: t.public_metrics?.retweet_count ?? 0, text: t.text.slice(0, 280) });
    }
    token = page.meta?.next_token;
    if (!token || (page.data ?? []).length === 0) break;
  }

  const quoteViews = quotes.map((q) => q.views);
  const byDay: Record<string, { quotes: number; quoteViews: number }> = {};
  for (const q of quotes) {
    const day = (q.createdAt ?? '').slice(0, 10);
    if (!day) continue;
    byDay[day] = byDay[day] ?? { quotes: 0, quoteViews: 0 };
    byDay[day].quotes += 1;
    byDay[day].quoteViews += q.views;
  }

  return new Response(JSON.stringify({
    post: { id, text: post.data.text, createdAt: post.data.created_at ?? null, metrics: post.data.public_metrics ?? {} },
    quotes: {
      read: quotes.length,
      reportedTotal: post.data.public_metrics?.quote_count ?? null,
      views: quoteViews.reduce((sum, v) => sum + v, 0),
      top10ShareOfQuoteViews: topShare(quoteViews, 10),
      byDay,
      topByViews: [...quotes].sort((a, b) => b.views - a.views).slice(0, 40),
      topByFollowers: [...quotes].sort((a, b) => b.followers - a.followers).slice(0, 25),
    },
    reposters: {
      read: reposters.length,
      reportedTotal: post.data.public_metrics?.retweet_count ?? null,
      combinedFollowers: reposters.reduce((sum, r) => sum + r.followers, 0),
      topByFollowers: [...reposters].sort((a, b) => b.followers - a.followers).slice(0, 25),
    },
    replies: {
      read: replies.length,
      reportedTotal: post.data.public_metrics?.reply_count ?? null,
      topByViews: [...replies].sort((a, b) => b.views - a.views).slice(0, 15),
    },
  }), { headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' } });
});
