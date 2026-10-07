import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { collabLabel } from './collab-label';

describe('collabLabel', () => {
  it('names every account on a collab and leaves solo posts alone', () => {
    assert.equal(collabLabel('The Boston Globe'), 'The Boston Globe');
    assert.equal(collabLabel('The Boston Globe', []), 'The Boston Globe');
    assert.equal(collabLabel('The Boston Globe', [{ name: 'Boston Globe Arts & Lifestyle' }]), 'The Boston Globe × Boston Globe Arts & Lifestyle');
    assert.equal(collabLabel('A', ['B', 'C']), 'A × B × C');
  });
});
