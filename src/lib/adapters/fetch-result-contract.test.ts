import assert from 'node:assert/strict';
import { it } from 'node:test';
import type { FetchResult } from './types';

const base = { posts: [], audience: [] };

// These compile-time guards make weakening the adapter contract fail the
// repository typecheck, even if every current adapter still happens to include
// the fields voluntarily.
// @ts-expect-error completeness must never be omitted
const missingCompleteness: FetchResult = base;
// @ts-expect-error an incomplete result must explain the source limitation
const missingReason: FetchResult = { ...base, hasMore: false, exhaustive: false };
// @ts-expect-error a certified window cannot advertise another page
const contradictoryComplete: FetchResult = { ...base, hasMore: true, exhaustive: true };

void missingCompleteness;
void missingReason;
void contradictoryComplete;

it('accepts only explicit certified and explained-incomplete results', () => {
  const complete: FetchResult = { ...base, hasMore: false, exhaustive: true };
  const incomplete: FetchResult = {
    ...base,
    hasMore: false,
    exhaustive: false,
    incompleteReason: 'The source exposes no terminal cursor.',
  };

  assert.equal(complete.exhaustive, true);
  assert.equal(incomplete.exhaustive, false);
});
