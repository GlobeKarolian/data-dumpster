import { test } from 'node:test';
import assert from 'node:assert/strict';
import { stubShortcodesInWindow, stubsMissingFromFeed } from './instagram-brightdata';
import { mergeFallbackPosts } from './meta';
import { selectedPublicSourceKey } from './runner';
import type { NormalizedPost } from './types';

const since = new Date('2026-10-20T12:00:00Z');
const until = new Date('2026-11-04T05:00:00Z');

// The slimmed profile stubs Bright Data returned for @boston (Nov 2026 shape).
const profileRow = {
  account: 'boston',
  posts: [
    { id: '1', url: 'https://www.instagram.com/p/DfSDGYeKvy_/', datetime: '2026-11-02', content_type: 'Video' },
    { id: '2', url: 'https://www.instagram.com/p/DfLCoc3jtbN/', datetime: '2026-10-31', content_type: 'Video' },
    { id: '3', url: 'https://www.instagram.com/p/De2rzKgjSak/', datetime: '2026-10-23', content_type: 'Video' },
    { id: '4', url: 'https://www.instagram.com/p/Dey_FdIRd2L/', datetime: '2026-10-22', content_type: 'Video' },
    // A pinned post from before the window is not evidence for this window.
    { id: '5', url: 'https://www.instagram.com/p/OLDPINNED/', datetime: '2026-06-01', content_type: 'Image' },
  ],
};

const post = (code: string, externalId: string): NormalizedPost => ({
  externalId,
  postedAt: new Date('2026-10-22T12:33:52Z'),
  type: 'reel',
  text: '',
  permalink: 'https://www.instagram.com/reel/' + code,
  mediaUrl: null,
  thumbnailUrl: null,
  durationSec: null,
  language: null,
  hashtags: [],
  mentions: [],
  urls: [],
  applause: 1,
  conversation: 0,
  amplification: 0,
  saves: 0,
  views: 0,
  raw: {},
});

test('stubs inside the window are the evidence; older pinned stubs are not', () => {
  assert.deepEqual(stubShortcodesInWindow(profileRow, since, until), ['DfSDGYeKvy_', 'DfLCoc3jtbN', 'De2rzKgjSak', 'Dey_FdIRd2L']);
  assert.deepEqual(stubShortcodesInWindow(undefined, since, until), []);
});

test("the @boston case: the feed returned one post, three proven posts are missing", () => {
  const codes = stubShortcodesInWindow(profileRow, since, until);
  assert.deepEqual(stubsMissingFromFeed(codes, [post('Dey_FdIRd2L', '4013547669745425803')]), ['DfSDGYeKvy_', 'DfLCoc3jtbN', 'De2rzKgjSak']);
  assert.deepEqual(stubsMissingFromFeed(codes, codes.map((c, i) => post(c, String(i)))), []);
});

test('fallback rows are added once, marked, and never replace a Bright Data row', () => {
  const primary = [post('Dey_FdIRd2L', '4013547669745425803')];
  const fallback = [post('Dey_FdIRd2L', '4013547669745425803'), post('DfLCoc3jtbN', '999')];
  const merged = mergeFallbackPosts(primary, fallback);
  assert.equal(merged.length, 2);
  assert.equal(merged[0], primary[0]);
  assert.equal(merged[1].raw?._fallbackSource, 'ensembledata');
});

test('Bright Data stays the planned Instagram source when both keys are present', () => {
  assert.equal(selectedPublicSourceKey('instagram', { brightDataApiKey: 'b', ensembleDataToken: 'e' }), 'brightdata');
});
