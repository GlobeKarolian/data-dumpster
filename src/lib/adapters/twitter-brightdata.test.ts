import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { errorRowFailure } from './twitter-brightdata';

describe('errorRowFailure', () => {
  it('classifies vendor error rows as retryable', () => {
    // When X shipped a frontend change, Bright Data answered every profile
    // with "Crawler error: waiting for selector [data-namespace=@xai/icons]".
    // As retryable:false that froze all ninety X channels as permanent
    // failures, and they stayed frozen after the vendor fixed their crawler.
    // A vendor error row proves the crawl failed, never that the account is
    // gone; the queue's consecutive-attempt ceiling bounds the retry spend.
    const err = errorRowFailure('BostonGlobe', [
      'X row error for @BostonGlobe: Crawler error: waiting for selector '
      + '".last-response [data-state=closed],h1 + button span[data-namespace=@xai/icons]"',
    ]);
    assert.equal(err.opts.retryable, true);
    assert.match(err.message, /Crawler error/);
    assert.match(err.message, /will be retried/);
  });

  it('stays retryable when the vendor gave no detail at all', () => {
    const err = errorRowFailure('BostonGlobe', []);
    assert.equal(err.opts.retryable, true);
    assert.match(err.message, /only error rows/);
  });
});
