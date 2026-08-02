import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { isPostMetricReported } from './post-metric-availability';

describe('isPostMetricReported', () => {
  it('always keeps a positive captured value', () => {
    assert.equal(isPostMetricReported('youtube', 'video', 'saves', 4), true);
    assert.equal(isPostMetricReported('instagram', 'photo', 'amplification', 2), true);
  });

  it('does not present unsupported Threads, Bluesky, or YouTube zeroes as facts', () => {
    assert.equal(isPostMetricReported('threads', 'text', 'views', 0), false);
    assert.equal(isPostMetricReported('threads', 'text', 'saves', 0), false);
    assert.equal(isPostMetricReported('bluesky', 'text', 'views', 0), false);
    assert.equal(isPostMetricReported('youtube', 'video', 'amplification', 0), false);
    assert.equal(isPostMetricReported('youtube', 'video', 'saves', 0), false);
  });

  it('keeps zeroes for metrics each platform reliably reports', () => {
    assert.equal(isPostMetricReported('threads', 'text', 'conversation', 0), true);
    assert.equal(isPostMetricReported('youtube', 'video', 'views', 0), true);
    assert.equal(isPostMetricReported('tiktok', 'video', 'saves', 0), true);
    assert.equal(isPostMetricReported('reddit', 'link', 'applause', 0), true);
    assert.equal(isPostMetricReported('reddit', 'text', 'conversation', 0), true);
    assert.equal(isPostMetricReported('reddit', 'photo', 'amplification', 0), false);
    assert.equal(isPostMetricReported('reddit', 'video', 'views', 0), false);
  });
});
