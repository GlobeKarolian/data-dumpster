import assert from 'node:assert/strict';
import test from 'node:test';
import type { MetricRow } from '@/lib/types';
import { measuredCompetitorAverage } from './availability';

function row(id: string, value: number, available: boolean): MetricRow {
  return {
    company: { id, name: id, slug: id },
    value,
    available,
    previousValue: null,
    previousAvailable: false,
    changePct: null,
    rank: available ? 1 : 0,
  };
}

test('competitor average excludes unavailable rows but retains measured zeroes', () => {
  const rows = [
    row('focus', 100, true),
    row('measured-zero', 0, true),
    row('measured-ten', 10, true),
    row('untracked', 0, false),
  ];

  assert.equal(measuredCompetitorAverage(rows, 'focus'), 5);
});

test('competitor average is null when no competitor was measured', () => {
  assert.equal(
    measuredCompetitorAverage([row('focus', 100, true), row('untracked', 0, false)], 'focus'),
    null,
  );
});
