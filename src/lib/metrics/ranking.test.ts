import assert from 'node:assert/strict';
import test from 'node:test';
import { sortByMetricDescending } from './ranking';

type Row = { name: string; value: number | null };

test('metric rankings put the highest measured value first and missing values last', () => {
  const rows: Row[] = [
    { name: 'Missing', value: null },
    { name: 'Low', value: -4 },
    { name: 'High', value: 42 },
    { name: 'Zero', value: 0 },
  ];

  assert.deepEqual(
    sortByMetricDescending(rows, (row) => row.value, (row) => row.name).map((row) => row.name),
    ['High', 'Zero', 'Low', 'Missing'],
  );
  assert.equal(rows[0]?.name, 'Missing', 'sorting must not mutate the source array');
});

test('metric ranking ties are stable by brand name', () => {
  const rows: Row[] = [
    { name: 'Zulu', value: 10 },
    { name: 'Alpha', value: 10 },
    { name: 'Unavailable B', value: Number.NaN },
    { name: 'Unavailable A', value: null },
  ];

  assert.deepEqual(
    sortByMetricDescending(rows, (row) => row.value, (row) => row.name).map((row) => row.name),
    ['Alpha', 'Zulu', 'Unavailable A', 'Unavailable B'],
  );
});
