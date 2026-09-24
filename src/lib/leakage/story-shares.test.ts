import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { buildShareQueries, linkKind, parseStoryUrl, placement, summarizeShares } from './story-shares';

const URL_ = 'https://www.bostonglobe.com/2026/09/22/magazine/greenfield-last-ditch-bar-backlash/';

describe('parseStoryUrl', () => {
  it('normalizes our story URLs', () => {
    const story = parseStoryUrl(URL_ + '?s_campaign=x');
    assert.equal(story.key, 'bostonglobe.com/2026/09/22/magazine/greenfield-last-ditch-bar-backlash');
    assert.deepEqual(story.slugTerms, ['greenfield', 'last', 'ditch', 'backlash']);
  });

  it('refuses other sites and section pages', () => {
    assert.throws(() => parseStoryUrl('https://www.nytimes.com/2026/09/22/x.html'), /our own/);
    assert.throws(() => parseStoryUrl('https://www.bostonglobe.com/metro/'), /section page/);
  });
});

describe('buildShareQueries', () => {
  it('searches the URL directly and bypass hosts by headline words', () => {
    const [direct, slug, bypass, mentions] = buildShareQueries(parseStoryUrl(URL_), ['Last Ditch', 'Greenfield']);
    assert.equal(direct.query, 'url:"https://www.bostonglobe.com/2026/09/22/magazine/greenfield-last-ditch-bar-backlash"');
    assert.equal(slug.query, 'url:"greenfield-last-ditch-bar-backlash"');
    assert.equal(mentions.query, '"Last Ditch" Greenfield -is:retweet');
    assert.ok(bypass.query.startsWith('(url:archive.ph OR url:archive.today'));
    assert.ok(bypass.query.endsWith(') "Last Ditch" Greenfield'));
  });
});

describe('linkKind', () => {
  const story = parseStoryUrl(URL_);
  it('treats an archive copy that embeds our URL as bypass, not direct', () => {
    const result = linkKind(story, [{ expanded_url: 'https://archive.ph/newest/' + URL_ }]);
    assert.deepEqual(result, { kind: 'bypass', tool: 'archive.ph' });
  });
  it('recognizes a direct link and a short archive id', () => {
    assert.equal(linkKind(story, [{ expanded_url: URL_ }]).kind, 'direct');
    assert.deepEqual(linkKind(story, [{ expanded_url: 'https://archive.today/Ab3xQ' }]), { kind: 'bypass', tool: 'archive.today' });
    assert.equal(linkKind(story, []).kind, 'none');
  });
});

describe('placement', () => {
  it('reads the referenced tweet types', () => {
    assert.equal(placement(undefined), 'original');
    assert.equal(placement([{ type: 'replied_to' }]), 'reply');
    assert.equal(placement([{ type: 'quoted' }, { type: 'replied_to' }]), 'quote');
    assert.equal(placement([{ type: 'retweeted' }]), 'retweet');
  });
});

describe('summarizeShares', () => {
  const base = { url: '', createdAt: '2026-09-23T10:00:00Z', likes: 0, reposts: 1, quotes: 0, replies: 0, text: '' };
  const posts = [
    { ...base, author: 'critic', followers: 100_000, placement: 'original' as const, link: 'direct' as const, tool: null, views: 3_000_000 },
    { ...base, author: 'reader', followers: 200, placement: 'reply' as const, link: 'bypass' as const, tool: 'archive.is', views: 900 },
    { ...base, author: 'reader2', followers: 300, placement: 'reply' as const, link: 'bypass' as const, tool: 'archive.ph', views: 100 },
    { ...base, author: 'outlet', followers: 29_000_000, placement: 'original' as const, link: 'none' as const, tool: null, views: 1_200_000 },
    { ...base, author: 'grok', followers: 9_000_000, placement: 'reply' as const, link: 'none' as const, tool: null, views: 10 },
  ];

  it('leaves automated replies out of people and reach', () => {
    const summary = summarizeShares(posts);
    assert.equal(summary.people, 4);
    assert.equal(summary.automatedPosts, 1);
    assert.equal(summary.views, 4_201_000);
  });

  it('splits linked, leaked and unlinked shares with the leak rate among links', () => {
    const summary = summarizeShares(posts);
    assert.equal(summary.linked.posts, 1);
    assert.equal(summary.leaked.posts, 2);
    assert.equal(summary.leaked.asReplies, 2);
    assert.deepEqual(summary.leaked.tools, { 'archive.is': 1, 'archive.ph': 1 });
    assert.equal(summary.unlinked.views, 1_200_000);
    assert.ok(Math.abs((summary.leakShareOfLinks ?? 0) - 2 / 3) < 1e-9);
  });

  it('reports no leak rate when nothing linked the story', () => {
    assert.equal(summarizeShares([]).leakShareOfLinks, null);
  });
});
