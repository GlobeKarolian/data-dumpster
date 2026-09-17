import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { TodayView } from './today-view';
import { CompareView } from './compare-view';
import { PostsView } from './posts-view';
import { Workspace } from './workspace';
import { canonicalState, rangeFor } from '@/lib/v2/state';
import type { V2Data } from '@/lib/v2/reader';
import type { PostDetailDto } from '@/lib/metrics/contract';
const state = canonicalState(new URLSearchParams('landscape=allowed'));
const post = { id: '00000000-0000-4000-8000-000000000001', company: { id: 'brand', name: 'Fixture newsroom', slug: 'brand' }, platform: 'instagram', type: 'photo', postedAt: '2026-09-16T12:00:00Z', text: 'A fixture headline for SSR verification', permalink: 'https://example.com/post', thumbnailUrl: 'https://example.com/image.jpg', applause: 14, conversation: 0, amplification: 0, saves: 0, views: 0, engagementTotal: 14, engagementRateByFollower: .0014, followersAtPost: 10000, tags: [], urls: [], medianEngagement: null, outlierScore: null } as const;
const data = { state, metric: 'posts', range: rangeFor(state, false, new Date('2026-09-16T12:00:00Z')), ctx: { landscape: { id: 'allowed', slug: 'allowed', name: 'Local market' }, landscapes: [{ id: 'allowed', slug: 'allowed', name: 'Local market' }], companies: [post.company], focusCompanyId: 'brand' }, posts: { items: [post], total: 51, page: 1, pageSize: 25 }, rows: [{ company: post.company, value: 14, available: true, complete: false, rank: 1 }], coverage: { totalChannels: 3, ingestedChannels: 0, limitedChannels: 2, partialChannels: 1, failedChannels: 0, blockedChannels: 0, neverAttemptedChannels: 0, collectingChannels: 0 }, detail: null } as unknown as V2Data;
test('monitor SSR contains real supplied post media, source limits and inspect link', () => {
  const html = renderToStaticMarkup(createElement(TodayView, { data }));
  assert.match(html, /A fixture headline/); assert.match(html, /v2\/media\//);
  assert.match(html, /Last 24 hours/); assert.match(html, /Inspect post/); assert.match(html, /Source health/);
  assert.doesNotMatch(html, /Refresh now|winner|AI summary/);
});
test('compare SSR renders chart and aligned table with honest partial values', () => {
  const html = renderToStaticMarkup(createElement(CompareView, { data }));
  assert.match(html, /Observed only/); assert.match(html, /<table/); assert.match(html, /v2-bars/);
  assert.match(html, /companies=brand/); assert.match(html, /Publishing/); assert.match(html, /Engagement/); assert.match(html, /Audience/);
});
test('posts SSR has true total, pagination and no invented inspector', () => {
  const html = renderToStaticMarkup(createElement(PostsView, { data }));
  assert.match(html, /51/); assert.match(html, /Next page/); assert.match(html, /Select a post/);
  assert.match(html, /Search posts/);
});
test('post result counter matches the selected sort metric', () => {
  const html = renderToStaticMarkup(createElement(PostsView, { data: { ...data, state: { ...state, sort: 'views' }, posts: { ...data.posts!, items: [{ ...data.posts!.items[0], views: 9876 }] } } }));
  assert.match(html, /9,876/); assert.match(html, /observed views/);
});
test('inspector displays captured comments but never generated summary', () => {
  const detail = { ...post, channel: { id: 'ch', handle: 'fixture', profileUrl: null, avatarUrl: null }, firstSeenAt: post.postedAt, lastRefreshedAt: post.postedAt, hashtags: [], mentions: [], urls: [], tags: [], comments: { collected: 1, summary: 'UNVERIFIED SUMMARY MUST NOT RENDER', items: [{ id: 'comment', text: 'Captured fixture comment', likes: 1, replies: 0, commentedAt: null }] }, metricHistory: [] } as unknown as PostDetailDto;
  const html = renderToStaticMarkup(createElement(PostsView, { data: { ...data, detail, state: { ...state, post: post.id, inspect: 'comments' } } }));
  assert.match(html, /Captured fixture comment/); assert.match(html, /not a representative sample/);
  assert.doesNotMatch(html, /UNVERIFIED SUMMARY/);
});
test('workspace exposes active navigation, native scope controls and original landscape link', () => {
  const html = renderToStaticMarkup(createElement(Workspace, { data, path: '/v2' }, 'Body'));
  assert.match(html, /aria-current="page"/); assert.match(html, /name="landscape"/);
  assert.match(html, /cross-channel\?landscape=allowed/); assert.match(html, /Data sources/);
});
