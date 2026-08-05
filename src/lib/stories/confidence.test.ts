import assert from 'node:assert/strict';
import test from 'node:test';
import { storySupportsCompetitiveConclusions } from './confidence';

test('competitive story conclusions require cohesion and more than one outlet', () => {
  assert.equal(storySupportsCompetitiveConclusions(0.24, 4), false);
  assert.equal(storySupportsCompetitiveConclusions(0.35, 1), false);
  assert.equal(storySupportsCompetitiveConclusions(0.35, 2), true);
  assert.equal(storySupportsCompetitiveConclusions(Number.NaN, 2), false);
});
