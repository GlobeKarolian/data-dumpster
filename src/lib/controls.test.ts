import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { controlSchemas, controlDefaults, controlsTestHelpers } from './controls';

const { overlay } = controlsTestHelpers;

describe('control registry', () => {
  it('every default satisfies its own schema', () => {
    for (const key of Object.keys(controlSchemas) as (keyof typeof controlSchemas)[]) {
      const parsed = controlSchemas[key].safeParse(controlDefaults[key]);
      assert.ok(parsed.success, key + ' default must be valid');
    }
  });

  it('overlays a partial stored row onto the default without losing new fields', () => {
    const merged = overlay(controlDefaults.comments, {
      enabled: false,
      platforms: { tiktok: { enabled: false } },
    }) as typeof controlDefaults.comments;
    assert.equal(merged.enabled, false);
    assert.equal(merged.platforms.tiktok.enabled, false);
    // Untouched fields arrive from the default.
    assert.equal(merged.platforms.tiktok.dailyRecordBudget,
      controlDefaults.comments.platforms.tiktok.dailyRecordBudget);
    assert.equal(merged.platforms.instagram.enabled, true);
    assert.equal(merged.commentsPerPost, 100);
  });

  it('replaces arrays wholesale rather than merging them', () => {
    const merged = overlay(
      { list: ['a', 'b'] },
      { list: ['c'] },
    ) as { list: string[] };
    assert.deepEqual(merged.list, ['c']);
  });

  it('rejects out-of-range values through the schema', () => {
    assert.equal(controlSchemas.comments.safeParse({
      ...controlDefaults.comments,
      commentsPerPost: 5_000,
    }).success, false);
    assert.equal(controlSchemas.ingest.safeParse({
      ...controlDefaults.ingest,
      refreshIntervalHours: 0,
    }).success, false);
  });
});
