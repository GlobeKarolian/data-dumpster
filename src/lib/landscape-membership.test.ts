import assert from 'node:assert/strict';
import { it } from 'node:test';
import { normalizedLandscapeMembers } from './landscape-membership';

it('deduplicates landscape members without changing their display order', () => {
  assert.deepEqual(
    normalizedLandscapeMembers(['company-b', 'company-a', 'company-b', 'company-c']),
    ['company-b', 'company-a', 'company-c'],
  );
});
