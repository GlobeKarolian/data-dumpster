import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { canUseLeakage } from './access';

describe('canUseLeakage', () => {
  it('admits only the named users, case-insensitively', () => {
    assert.equal(canUseLeakage('matt@boston.com'), true);
    assert.equal(canUseLeakage(' Matt@Boston.com '), true);
    assert.equal(canUseLeakage('matt.karolian@globe.com'), true);
  });
  it('refuses everyone else, including other owners', () => {
    assert.equal(canUseLeakage('someone@bostonglobe.com'), false);
    assert.equal(canUseLeakage(''), false);
    assert.equal(canUseLeakage(null), false);
  });
});
