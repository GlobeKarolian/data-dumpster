import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const source = readFileSync(new URL('./election-tracker-preview.tsx', import.meta.url), 'utf8');

test('election tracker keeps mock data visibly separated from production metrics', () => {
  assert.match(source, /Concept preview · sample data/);
  assert.match(source, /Not connected to collection/);
  assert.match(source, /fictional/);
  assert.match(source, /not polling, vote intention or an election forecast/i);
});

test('election tracker exposes the four product concepts requested for review', () => {
  assert.match(source, /State of the field/);
  assert.match(source, /Candidate profiles/);
  assert.match(source, /Head-to-head/);
  assert.match(source, /Top content/);
});
