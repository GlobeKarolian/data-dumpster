import assert from 'node:assert/strict';
import test from 'node:test';
import { companiesInScope, effectiveFocusCompanyId } from './analytics-scope';

test('a selected set keeps the configured focus when it remains visible', () => {
  assert.equal(effectiveFocusCompanyId('focus', ['other', 'focus']), 'focus');
});

test('a selected set promotes its first company when it excludes the configured focus', () => {
  assert.equal(effectiveFocusCompanyId('focus', ['first', 'second']), 'first');
  assert.equal(effectiveFocusCompanyId(null, ['first']), 'first');
});

test('chart companies are restricted to the selected company scope', () => {
  assert.deepEqual(
    companiesInScope([{ id: 'a' }, { id: 'b' }, { id: 'c' }], ['c', 'a']),
    [{ id: 'a' }, { id: 'c' }],
  );
});

