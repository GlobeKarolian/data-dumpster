import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { breakdownByType, buildAnalysisPrompt, validateAnalysis } from './analysis';
import type { SharePost } from './story-shares';

const post = (over: Partial<SharePost>): SharePost => ({
  url: 'u', createdAt: null, author: 'a', followers: 1, placement: 'original', link: 'direct', tool: null,
  likes: 0, reposts: 0, quotes: 0, replies: 0, views: 0, text: '', ...over,
});
const posts = [
  post({ url: 'https://x.com/critic/1', author: 'critic', views: 3_000_000 }),
  post({ url: 'https://x.com/reader/2', author: 'reader', link: 'bypass', tool: 'archive.is', placement: 'reply', views: 900, text: 'no paywall link' }),
  post({ url: 'https://x.com/FoxNews/3', author: 'FoxNews', link: 'none', views: 1_200_000 }),
];
const accounts = posts.map((p) => ({ username: p.author, name: null, followers: 1, bio: '', verified: null }));

describe('leakage analysis', () => {
  it('numbers every leaked post and the most-seen posts for the model', () => {
    const { request, postIds } = buildAnalysisPrompt({ headline: 'H', storyKey: 'k', summaryLine: 's', accounts, posts });
    assert.equal(postIds.size, 3);
    assert.ok(request.messages[1].content.includes('leaked copy via archive.is'));
  });

  it('keeps only labels for real accounts and posts', () => {
    const { postIds } = buildAnalysisPrompt({ headline: 'H', storyKey: 'k', summaryLine: 's', accounts, posts });
    const idOf = (url: string) => [...postIds.entries()].find(([, u]) => u === url)?.[0];
    const result = validateAnalysis({
      account_types: [
        { username: '@FoxNews', type: 'news_outlet' },
        { username: 'invented', type: 'journalist' },
        { username: 'critic', type: 'wizard' },
      ],
      workaround: [
        { id: idOf('https://x.com/reader/2'), offers_workaround: true },
        { id: idOf('https://x.com/critic/1'), offers_workaround: true },
      ],
      stance: [{ id: idOf('https://x.com/critic/1'), stance: 'amplifying' }, { id: 'p99', stance: 'mocking' }],
      findings: [{ headline: 'One post drove most reach', detail: 'The critic post had 3,000,000 views.' }, { headline: '', detail: 'x' }],
    }, accounts, postIds, new Set(['https://x.com/reader/2']));
    assert.deepEqual(result.accountTypes, { FoxNews: 'news_outlet' });
    assert.deepEqual(result.workaround, { 'https://x.com/reader/2': true }, 'workaround applies to leaked posts only');
    assert.deepEqual(result.stance, { 'https://x.com/critic/1': 'amplifying' });
    assert.equal(result.findings.length, 1);
  });

  it('breaks shares down by account type with unlabeled accounts as readers', () => {
    const rows = breakdownByType(posts, { FoxNews: 'news_outlet', critic: 'commentator' });
    assert.deepEqual(rows.map((r) => [r.type, r.views, r.leaked, r.unlinked]), [
      ['commentator', 3_000_000, 0, 0],
      ['news_outlet', 1_200_000, 0, 1],
      ['reader', 900, 1, 0],
    ]);
  });
});
