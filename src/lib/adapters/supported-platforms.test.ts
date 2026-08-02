import assert from 'node:assert/strict';
import test from 'node:test';
import { ADAPTER_SUPPORTED_PLATFORMS } from './supported-platforms';

test('channel pickers expose implemented adapters only', () => {
  assert.ok(ADAPTER_SUPPORTED_PLATFORMS.includes('youtube'));
  assert.ok(ADAPTER_SUPPORTED_PLATFORMS.includes('reddit'));
  assert.equal(ADAPTER_SUPPORTED_PLATFORMS.includes('rss' as never), false);
});
