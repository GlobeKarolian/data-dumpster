import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { buildShareQueries, linkKind, parseStoryUrl, placement } from './story-shares';

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
    const [direct, bypass] = buildShareQueries(parseStoryUrl(URL_), ['Last Ditch', 'Greenfield']);
    assert.equal(direct.query, 'url:"bostonglobe.com/2026/09/22/magazine/greenfield-last-ditch-bar-backlash"');
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
