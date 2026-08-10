import assert from 'node:assert/strict';
import test from 'node:test';
import { reportManualRows } from './manual-rows';
import { MANUAL_SECTIONS } from './types';
import { parseTable } from './tsv';

const source = [
  'Rank\tQuery\tURL Clicks\tClicks % Δ\tImpressions\tImpressions % Δ\tURL CTR\tCTR % Δ',
  '1\tlindsay clancy\t127,213\t71.1%\t1,991,242\t45.9%\t6.39%\t17.3%',
  '2\tboston globe\t47,781\t-10.7%\t532,216\t-4.1%\t8.98%\t-6.9%',
].join('\n');

test('maps the wider Looker comparison table onto the report search columns', () => {
  const spec = MANUAL_SECTIONS.find((section) => section.id === 'globeSearch');
  assert.ok(spec);
  const parsed = parseTable(source, spec.columns);
  assert.equal(parsed.headerDropped, true);
  assert.deepEqual(parsed.rows, [
    ['lindsay clancy', '127,213', '1,991,242', '6.39%', ''],
    ['boston globe', '47,781', '532,216', '8.98%', ''],
  ]);
});

test('repairs previously clipped search rows from the retained raw paste', () => {
  assert.deepEqual(reportManualRows('globeSearch', {
    raw: source,
    rows: [['Rank', 'Query', 'URL Clicks', 'Clicks % Δ', 'Impressions']],
    updatedAt: '2026-08-10T20:00:00.000Z',
  }), [
    ['lindsay clancy', '127,213', '1,991,242', '6.39%', ''],
    ['boston globe', '47,781', '532,216', '8.98%', ''],
  ]);
});

test('never caps the number of included search rows', () => {
  const rows = Array.from({ length: 40 }, (_, index) => [
    `query ${index + 1}`, String(40 - index), '100', '40%', '',
  ]);
  assert.equal(reportManualRows('bostonSearch', {
    raw: '', rows, updatedAt: null,
  }).length, 40);
});
