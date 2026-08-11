import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { canTriggerManualRefresh } from './manual-refresh-policy';

describe('manual refresh policy', () => {
  it('allows the two named operator accounts', () => {
    assert.equal(canTriggerManualRefresh('matt.karolian@globe.com'), true);
    assert.equal(canTriggerManualRefresh('matt@boston.com'), true);
  });

  it('normalizes harmless email casing and whitespace', () => {
    assert.equal(canTriggerManualRefresh('  MATT.KAROLIAN@GLOBE.COM  '), true);
  });

  it('does not grant the capability to other or missing identities', () => {
    assert.equal(canTriggerManualRefresh('editor@globe.com'), false);
    assert.equal(canTriggerManualRefresh(null), false);
    assert.equal(canTriggerManualRefresh(undefined), false);
  });
});
