import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { playsByShortcode, reelPlays, reelShortcode } from './instagram-reel-plays';

describe('instagram reel plays', () => {
  it('reads the same shortcode from post and reel URLs', () => {
    assert.equal(reelShortcode('https://www.instagram.com/p/DdocHTCjMKc/'), 'DdocHTCjMKc');
    assert.equal(reelShortcode('https://www.instagram.com/reel/DdocHTCjMKc/?igsh=x'), 'DdocHTCjMKc');
    assert.equal(reelShortcode('https://www.instagram.com/bostonglobe/reel/DdocHTCjMKc'), 'DdocHTCjMKc');
    assert.equal(reelShortcode('https://www.instagram.com/bostonglobe/'), null);
  });

  it('takes the largest play field', () => {
    assert.equal(reelPlays({ views: 0, video_play_count: 51_200 }), 51_200);
    assert.equal(reelPlays({ views: '1,204' }), 1204);
  });

  it('maps rows to shortcodes and skips errors and zeros', () => {
    const map = playsByShortcode([
      { url: 'https://www.instagram.com/reel/AAA111/', video_play_count: 9000 },
      { url: 'https://www.instagram.com/reel/BBB222/', views: 0 },
      { error: 'not found', input: { url: 'https://www.instagram.com/reel/CCC333/' } },
      { input: { url: 'https://www.instagram.com/p/DDD444/' }, views: 12 },
    ]);
    assert.deepEqual([...map.entries()], [['AAA111', 9000], ['DDD444', 12]]);
  });
});
