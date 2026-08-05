import assert from 'node:assert/strict';
import test from 'node:test';
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type { MetricRow } from '@/lib/types';
import { BarLeaderboard } from './bar-leaderboard';

function rows(count: number, available: boolean, value: number): MetricRow[] {
  return Array.from({ length: count }, (_, index) => ({
    company: {
      id: 'company-' + index,
      name: 'Company ' + index,
      slug: 'company-' + index,
    },
    value,
    available,
    previousValue: null,
    previousAvailable: false,
    changePct: null,
    rank: available ? index + 1 : 0,
  }));
}

function render(metricRows: MetricRow[], metric: 'audienceNetChange' | 'posts'): string {
  return renderToStaticMarkup(React.createElement(BarLeaderboard, {
    rows: metricRows,
    metric,
    maxRows: 30,
    focusCompanyId: null,
  }));
}

test('an all-unavailable leaderboard uses a compact honest empty state', () => {
  const html = render(rows(30, false, 0), 'audienceNetChange');

  assert.match(html, /Not enough observations to compute this metric/);
  assert.match(html, /style="height:120px"/);
  assert.doesNotMatch(html, /style="height:808px"/);
});

test('an all-zero leaderboard uses the same compact empty state', () => {
  const html = render(rows(30, true, 0), 'posts');

  assert.match(html, /Every measured company is zero here/);
  assert.match(html, /style="height:120px"/);
  assert.doesNotMatch(html, /style="height:808px"/);
});

test('a measured leaderboard still scales to its visible rows', () => {
  const html = render(rows(30, true, 10), 'posts');

  assert.match(html, /style="height:808px"/);
});

test('a negative value below zero-valued top rows is still a measured signal', () => {
  const metricRows = rows(13, true, 0);
  metricRows[12] = { ...metricRows[12], value: -5 };
  const html = renderToStaticMarkup(React.createElement(BarLeaderboard, {
    rows: metricRows,
    metric: 'audienceNetChange',
    focusCompanyId: null,
  }));

  assert.doesNotMatch(html, /Every measured company is zero here/);
});

test('platform breakdown legend sits in its own wrapping row', () => {
  const metricRows = rows(1, true, 10);
  metricRows[0] = {
    ...metricRows[0],
    breakdown: { facebook: 6, instagram: 4 },
    breakdownAvailability: { facebook: true, instagram: true },
  };
  const html = renderToStaticMarkup(React.createElement(BarLeaderboard, {
    rows: metricRows,
    metric: 'posts',
    focusCompanyId: null,
    showPlatformBreakdown: true,
  }));

  assert.match(html, /aria-label="Platform breakdown"/);
  assert.match(html, /flex-wrap/);
  assert.match(html, />Facebook</);
  assert.match(html, />Instagram</);
  assert.doesNotMatch(html, /recharts-legend-wrapper/);
});
