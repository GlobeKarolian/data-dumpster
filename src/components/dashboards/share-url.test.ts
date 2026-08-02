import assert from 'node:assert/strict';
import test from 'node:test';
import { absoluteShareUrl } from './share-url';

test('a dashboard share URL stays absolute after a server reload', () => {
  assert.equal(
    absoluteShareUrl('/share/abc123', 'https://pressbox-kappa.vercel.app'),
    'https://pressbox-kappa.vercel.app/share/abc123',
  );
});

test('an API-provided absolute share URL is preserved', () => {
  assert.equal(
    absoluteShareUrl('https://example.test/share/abc123', 'https://ignored.test'),
    'https://example.test/share/abc123',
  );
});

