import assert from 'node:assert/strict';
import test from 'node:test';
import {
  DEFAULT_POST_COLUMNS,
  defaultPostColumnsForPlatforms,
  REDDIT_POST_COLUMNS,
} from './post-columns';

test('Reddit-only filters use Reddit performance columns', () => {
  assert.deepEqual(defaultPostColumnsForPlatforms(['reddit']), REDDIT_POST_COLUMNS);
  assert.deepEqual(REDDIT_POST_COLUMNS, [
    'postedAt',
    'text',
    'engagementTotal',
    'applause',
    'conversation',
    'amplification',
    'type',
  ]);
});

test('mixed, other, and unfiltered views keep the general defaults', () => {
  assert.deepEqual(defaultPostColumnsForPlatforms([]), DEFAULT_POST_COLUMNS);
  assert.deepEqual(defaultPostColumnsForPlatforms(['instagram']), DEFAULT_POST_COLUMNS);
  assert.deepEqual(
    defaultPostColumnsForPlatforms(['reddit', 'instagram']),
    DEFAULT_POST_COLUMNS,
  );
});
