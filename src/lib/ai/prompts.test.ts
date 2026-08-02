import assert from 'node:assert/strict';
import test from 'node:test';
import type { FactSheet } from '@/lib/metrics/contract';
import { numberIndex, renderFactSheet } from './prompts';

function facts(): FactSheet {
  return {
    landscape: { id: 'landscape', name: 'Market', focusCompany: 'Focus' },
    range: { start: '2026-07-01', end: '2026-07-07', days: 7 },
    previousRange: { start: '2026-06-24', end: '2026-06-30' },
    companies: [
      { id: 'focus', name: 'Focus', slug: 'focus' },
      { id: 'missing', name: 'Missing', slug: 'missing' },
    ],
    leaderboards: {
      audienceNetChange: [
        {
          company: { id: 'focus', name: 'Focus', slug: 'focus' },
          value: 12,
          available: true,
          previousValue: null,
          previousAvailable: false,
          changePct: null,
          rank: 1,
          breakdown: { instagram: 12, youtube: 0 },
          breakdownAvailability: { instagram: true, youtube: false },
        },
        {
          company: { id: 'missing', name: 'Missing', slug: 'missing' },
          value: 0,
          available: false,
          previousValue: null,
          previousAvailable: false,
          changePct: null,
          rank: 0,
        },
      ],
    },
    focusSummary: null,
    topPostsOverall: [],
    tagPerformance: [],
    postTypePerformance: [],
    notableUrls: [],
    anomalies: [],
    caveats: [],
  };
}

test('AI number index omits unavailable metric fallbacks and platform splits', () => {
  const paths = numberIndex(facts()).map((entry) => entry.path);

  assert.ok(paths.includes('facts.leaderboards.audienceNetChange[0].value'));
  assert.ok(paths.includes('facts.leaderboards.audienceNetChange[0].breakdown.instagram'));
  assert.ok(!paths.includes('facts.leaderboards.audienceNetChange[0].breakdown.youtube'));
  assert.ok(!paths.includes('facts.leaderboards.audienceNetChange[1].value'));
  assert.ok(!paths.includes('facts.leaderboards.audienceNetChange[1].rank'));
});

test('model payload omits an unavailable row value rather than showing zero', () => {
  const rendered = renderFactSheet(facts());
  const missingRow = rendered.slice(rendered.indexOf('"name": "Missing"'));

  assert.doesNotMatch(missingRow, /"value": 0/);
});
