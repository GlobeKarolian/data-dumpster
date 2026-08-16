import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  SNAPSHOT_COLUMNS,
  snapshotValuesFor,
  type SnapshotSourceRow,
} from './snapshot-values';

const at = new Date('2026-08-16T12:00:00.000Z');
const run = 'run-1';

function row(externalId: string, applause = 1): SnapshotSourceRow {
  return {
    externalId,
    applause,
    conversation: 0,
    amplification: 0,
    saves: 0,
    views: 0,
    engagementTotal: applause,
  };
}

describe('snapshotValuesFor', () => {
  it('emits exactly one row per post id within a run', () => {
    // The regression: Facebook's paged vendor payload repeats a post, both
    // occurrences map to one pooled post id, and two identical
    // (post_id, captured_at) keys in one ON CONFLICT DO UPDATE statement fail
    // with "cannot affect row a second time". 1,054 production failures.
    const ids = new Map([['fb-1', 'post-a'], ['fb-2', 'post-b']]);
    const values = snapshotValuesFor(
      [row('fb-1', 10), row('fb-2', 20), row('fb-1', 30)],
      ids, at, run,
    );
    assert.equal(values.length, 2);
    const keys = values.map((v) => v.postId + '|' + v.capturedAt.toISOString());
    assert.equal(new Set(keys).size, values.length, 'duplicate conflict key survived');
  });

  it('keeps the later duplicate, matching upsertPosts semantics', () => {
    const ids = new Map([['fb-1', 'post-a']]);
    const values = snapshotValuesFor([row('fb-1', 10), row('fb-1', 30)], ids, at, run);
    assert.equal(values.length, 1);
    assert.equal(values[0].applause, 30,
      'the two writers must agree on which duplicate is current');
  });

  it('skips rows whose post upsert produced no id', () => {
    const ids = new Map([['fb-1', 'post-a']]);
    const values = snapshotValuesFor([row('fb-1'), row('fb-unknown')], ids, at, run);
    assert.equal(values.length, 1);
    assert.equal(values[0].postId, 'post-a');
  });

  it('stamps run provenance and public visibility on every row', () => {
    const ids = new Map([['fb-1', 'post-a']]);
    const [v] = snapshotValuesFor([row('fb-1')], ids, at, run);
    assert.equal(v.sourceRunId, run);
    assert.equal(v.visibility, 'public_comparable');
    assert.equal(v.capturedAt, at);
  });

  it('SNAPSHOT_COLUMNS matches the real row width', () => {
    // The inline version chunked by 8 while the table had 10 columns, quietly
    // overrunning the bind-parameter budget by a quarter.
    const ids = new Map([['fb-1', 'post-a']]);
    const [v] = snapshotValuesFor([row('fb-1')], ids, at, run);
    assert.equal(Object.keys(v).length, SNAPSHOT_COLUMNS);
  });

  it('returns nothing for an empty run', () => {
    assert.deepEqual(snapshotValuesFor([], new Map(), at, run), []);
  });
});
