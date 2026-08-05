import assert from 'node:assert/strict';
import test from 'node:test';
import { buildContentSecurityPolicy } from '../next.config';

test('development CSP permits only the eval support React diagnostics require', () => {
  const policy = buildContentSecurityPolicy(true);
  assert.match(policy, /script-src 'self' 'unsafe-inline' 'unsafe-eval'/);
  assert.match(policy, /frame-ancestors 'none'/);
  assert.doesNotMatch(policy, /(?:^|\s)\*(?:\s|;|$)/);
});

test('production CSP never permits eval', () => {
  const policy = buildContentSecurityPolicy(false);
  assert.match(policy, /script-src 'self' 'unsafe-inline'/);
  assert.doesNotMatch(policy, /unsafe-eval/);
});
