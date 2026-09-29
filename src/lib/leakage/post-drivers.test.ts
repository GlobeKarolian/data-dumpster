import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { parseTweetId, topShare } from './post-drivers';

describe('parseTweetId', () => {
  it('reads ids and status URLs', () => {
    assert.equal(parseTweetId('2102398080590979328'), '2102398080590979328');
    assert.equal(parseTweetId('https://x.com/BostonGlobe/status/2102398080590979328?s=20'), '2102398080590979328');
    assert.equal(parseTweetId('https://twitter.com/a/status/123456789'), '123456789');
    assert.equal(parseTweetId('https://x.com/BostonGlobe'), null);
  });
});

describe('topShare', () => {
  it('reports how concentrated a total is', () => {
    assert.equal(topShare([90, 5, 5], 1), 0.9);
    assert.equal(topShare([], 3), null);
  });
});
