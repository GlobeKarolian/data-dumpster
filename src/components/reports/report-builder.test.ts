import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';

const source = readFileSync(new URL('./report-builder.tsx', import.meta.url), 'utf8');

describe('weekly report recompute control', () => {
  it('surfaces recompute in the normal report toolbar for editors', () => {
    assert.match(source, /canEdit && mode === 'view'/);
    assert.match(source, /Recompute data/);
    assert.match(source, /Recomputing data/);
  });

  it('reports completion and errors without silently continuing after a failed save', () => {
    assert.match(source, /role="status"/);
    assert.match(source, /role="alert"/);
    assert.match(source, /if \(!\(await persist\(\)\)\) throw new Error/);
  });
});
