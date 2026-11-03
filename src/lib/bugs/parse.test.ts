import { test } from 'node:test';
import assert from 'node:assert/strict';
import { extractUrls, heuristicTriage, parseSocialPostUrl, postUrlsIn, unsupportedNumbers } from './parse';

test('extracts urls from a Slack-style message, trimming punctuation', () => {
  const text = "hi again, we're not seeing this: https://www.instagram.com/p/DfLCoc3jtbN/. also (https://x.com/a/status/1)";
  assert.deepEqual(extractUrls(text), ['https://www.instagram.com/p/DfLCoc3jtbN/', 'https://x.com/a/status/1']);
});

test('instagram /p/ links carry no handle; /<handle>/reel/ links do', () => {
  assert.deepEqual(parseSocialPostUrl('https://www.instagram.com/p/DfLCoc3jtbN/'), {
    url: 'https://www.instagram.com/p/DfLCoc3jtbN/', platform: 'instagram', handle: null, postKey: 'DfLCoc3jtbN',
  });
  const reel = parseSocialPostUrl('https://www.instagram.com/boston/reel/De2rzKgjSak/?igsh=abc');
  assert.equal(reel?.handle, 'boston');
  assert.equal(reel?.postKey, 'De2rzKgjSak');
});

test('parses the other networks', () => {
  assert.deepEqual(
    [
      'https://x.com/BostonGlobe/status/1850000000000000000',
      'https://www.threads.com/@boston/post/DFabc123',
      'https://www.tiktok.com/@bostonglobe/video/7400000000000000000',
      'https://bsky.app/profile/bostonglobe.com/post/3lxyz',
      'https://www.youtube.com/shorts/abcDEF12345',
      'https://www.facebook.com/globe/posts/pfbid02abc',
      'https://www.linkedin.com/feed/update/urn:li:activity:7250000000000000000/',
      'https://www.reddit.com/r/boston/comments/1abcde/title/',
    ].map((u) => { const p = parseSocialPostUrl(u); return p && [p.platform, p.handle, p.postKey]; }),
    [
      ['twitter', 'bostonglobe', '1850000000000000000'],
      ['threads', 'boston', 'DFabc123'],
      ['tiktok', 'bostonglobe', '7400000000000000000'],
      ['bluesky', 'bostonglobe.com', '3lxyz'],
      ['youtube', null, 'abcDEF12345'],
      ['facebook', 'globe', 'pfbid02abc'],
      ['linkedin', null, '7250000000000000000'],
      ['reddit', null, '1abcde'],
    ],
  );
});

test('profile and article links are not posts', () => {
  assert.equal(parseSocialPostUrl('https://www.instagram.com/boston/'), null);
  assert.equal(parseSocialPostUrl('https://www.bostonglobe.com/2026/11/01/metro/story/'), null);
  assert.equal(parseSocialPostUrl('not a url'), null);
});

test('postUrlsIn deduplicates the same post linked twice', () => {
  const text = 'https://www.instagram.com/p/AAA/ and https://www.instagram.com/boston/reel/AAA/';
  assert.equal(postUrlsIn(text).length, 1);
});

test('rules route the classic missing-post report', () => {
  assert.deepEqual(heuristicTriage("we're not seeing this show up on data dumpster", true), { area: 'missing_data', severity: 'medium' });
  assert.equal(heuristicTriage('I cannot log in', false).area, 'access');
  assert.equal(heuristicTriage('everything is down', false).severity, 'high');
  assert.equal(heuristicTriage('small typo on the costs page', false).severity, 'low');
});

test('numbers the model invents are caught; numbers in the sheet pass', () => {
  const sheet = JSON.stringify({ postsLast14Days: 2, newest: '2026-10-22', overdue: 436, total: 1946 });
  assert.deepEqual(unsupportedNumbers('Only 2 posts since 2026-10-22; 436 profiles overdue.', sheet), []);
  assert.deepEqual(unsupportedNumbers('Roughly 40 posts are missing.', sheet), ['40']);
  assert.deepEqual(unsupportedNumbers('1,946 posts', sheet), []);
});
