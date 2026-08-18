import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { lifecycleRank, readLifecycle, type LifecyclePoint } from './story-lifecycle';

const pt = (date: string, posts: number, engagement: number): LifecyclePoint =>
  ({ date, posts, engagement });

describe('reading an arc', () => {
  it('refuses a verdict on a window too short to have a shape', () => {
    const reading = readLifecycle([pt('2026-08-01', 3, 100), pt('2026-08-02', 4, 120)], { maturingBuckets: 0 });
    assert.equal(reading.phase, 'unknown');
    assert.equal(reading.peakDate, null);
    assert.match(reading.summary, /Not enough of a window/);
  });

  it('calls a story peaking when the high point is in the trailing buckets', () => {
    const reading = readLifecycle([
      pt('2026-08-11', 2, 200),
      pt('2026-08-12', 3, 400),
      pt('2026-08-13', 5, 900),
      pt('2026-08-14', 6, 2_000),
      pt('2026-08-15', 6, 2_200),
    ], { maturingBuckets: 0 });
    assert.equal(reading.phase, 'peaking');
    assert.equal(reading.peakDate, '2026-08-15');
    assert.match(reading.summary, /Peaking now/);
  });

  it('calls a story faded when reaction collapsed away from the peak', () => {
    const reading = readLifecycle([
      pt('2026-08-10', 8, 5_000),
      pt('2026-08-11', 9, 9_000),
      pt('2026-08-12', 4, 1_200),
      pt('2026-08-13', 2, 600),
      pt('2026-08-14', 1, 300),
    ], { maturingBuckets: 0 });
    assert.equal(reading.phase, 'fading');
    assert.equal(reading.peakDate, '2026-08-11');
    assert.match(reading.summary, /Faded to \d+% of its 2026-08-11 peak/);
  });

  it('makes no claim about output, which tag coverage is not yet even enough to support', () => {
    // Same collapse, but with publishing volume held flat. The reading must
    // describe the reaction and stay silent about whether the newsroom
    // over-published, because bucket volume counts TAGGED posts and coverage
    // is still filling in newest-first.
    const reading = readLifecycle([
      pt('2026-08-10', 10, 9_000),
      pt('2026-08-11', 10, 8_000),
      pt('2026-08-12', 10, 1_000),
      pt('2026-08-13', 10, 800),
      pt('2026-08-14', 10, 700),
    ], { maturingBuckets: 0 });
    assert.equal(reading.phase, 'fading');
    assert.doesNotMatch(reading.summary, /publishing|output/i);
  });

  it('reads the tail as a mean, so one quiet day does not kill a live story', () => {
    const reading = readLifecycle([
      pt('2026-08-11', 5, 1_000),
      pt('2026-08-12', 5, 1_100),
      pt('2026-08-13', 5, 1_200),
      pt('2026-08-14', 5, 1_150),
      // A single dead bucket at the end, of the kind a partial day produces.
      pt('2026-08-15', 1, 200),
    ], { maturingBuckets: 0 });
    assert.notEqual(reading.phase, 'fading');
  });

  it('says so plainly when nothing was measured', () => {
    const reading = readLifecycle([
      pt('2026-08-11', 0, 0), pt('2026-08-12', 0, 0),
      pt('2026-08-13', 0, 0), pt('2026-08-14', 0, 0),
    ], { maturingBuckets: 0 });
    assert.equal(reading.phase, 'unknown');
    assert.match(reading.summary, /No measured reaction/);
  });

  it('totals posts and engagement across the window', () => {
    const reading = readLifecycle([
      pt('2026-08-11', 2, 100), pt('2026-08-12', 3, 200),
      pt('2026-08-13', 4, 300), pt('2026-08-14', 5, 400),
    ], { maturingBuckets: 0 });
    assert.equal(reading.totalPosts, 14);
    assert.equal(reading.totalEngagement, 1_000);
  });
});

describe('immature buckets', () => {
  /*
   * The bug this defends against shipped as far as a live run: engagement on
   * a post published hours ago has not accrued, so the newest buckets are
   * near-zero for every story and the naive reading called all 51 tags
   * "fading — publishing past the audience", including ones at their peak.
   */
  it('does not let unaccrued trailing buckets declare a live story dead', () => {
    const stillHot = [
      pt('2026-08-12', 8, 5_000),
      pt('2026-08-13', 9, 8_000),
      pt('2026-08-14', 9, 9_000),
      pt('2026-08-15', 9, 9_500),
      // Today and yesterday: posts are out, reaction has not landed yet.
      pt('2026-08-16', 9, 400),
      pt('2026-08-17', 6, 60),
    ];
    assert.notEqual(readLifecycle(stillHot, { maturingBuckets: 0 }).phase, 'peaking');
    assert.equal(readLifecycle(stillHot).phase, 'peaking');
  });

  it('still counts immature buckets in the totals, because those posts are real', () => {
    const reading = readLifecycle([
      pt('2026-08-12', 2, 1_000), pt('2026-08-13', 2, 1_000),
      pt('2026-08-14', 2, 1_000), pt('2026-08-15', 2, 1_000),
      pt('2026-08-16', 3, 50), pt('2026-08-17', 3, 10),
    ]);
    assert.equal(reading.totalPosts, 14);
    assert.equal(reading.totalEngagement, 4_060);
  });

  it('withholds a verdict when too little of the window has matured', () => {
    const reading = readLifecycle([
      pt('2026-08-14', 2, 900), pt('2026-08-15', 2, 800),
      pt('2026-08-16', 2, 100), pt('2026-08-17', 2, 20),
    ]);
    assert.equal(reading.phase, 'unknown');
  });
});

describe('surfacing order', () => {
  it('puts a live story above a bigger dead one', () => {
    const live = readLifecycle([
      pt('2026-08-11', 2, 100), pt('2026-08-12', 3, 300),
      pt('2026-08-13', 4, 800), pt('2026-08-14', 5, 1_000),
    ], { maturingBuckets: 0 });
    const dead = readLifecycle([
      pt('2026-08-11', 20, 90_000), pt('2026-08-12', 15, 40_000),
      pt('2026-08-13', 4, 900), pt('2026-08-14', 2, 300),
    ], { maturingBuckets: 0 });
    assert.equal(live.phase, 'peaking');
    assert.equal(dead.phase, 'fading');
    assert.ok(lifecycleRank(live) > lifecycleRank(dead));
  });
});
