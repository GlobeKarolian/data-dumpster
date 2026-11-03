import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isVendorAccountError } from './vendor-account';

test('the two real 2026 outages are recognized as vendor account failures', () => {
  // Verbatim from production ingestion_runs.
  assert.equal(isVendorAccountError('Bright Data: HTTP 400. Customer is not active'), true);
  assert.equal(isVendorAccountError(
    'Every configured X source failed. X API v2: HTTP 402 from twitter: Payment Required: credits depleted',
  ), true);
  assert.equal(isVendorAccountError('HTTP 402 from twitter: Payment Required'), true);
  assert.equal(isVendorAccountError('Insufficient balance on account'), true);
});

test('profile-level failures stay profile-level', () => {
  for (const message of [
    'Bright Data returned no Instagram profile for nasa Profile isn\'t available',
    'Identity conflict for facebook boston: this pooled profile is bound to platform id "1"',
    'HTTP 404 from twitter: Not Found',
    'X account suspended',
    'No YouTube channel found for "raysbaseball"',
    'HTTP 402 from twitter',
    '',
  ]) {
    assert.equal(isVendorAccountError(message), false, message);
  }
  assert.equal(isVendorAccountError(null), false);
});
