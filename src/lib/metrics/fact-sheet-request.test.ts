import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { AnalyticsQuery } from '@/lib/types';
import type { FactSheet } from './contract';
import { factSheetFingerprint, factSheetScopeFromQuery } from './fact-sheet-request';

const start = new Date('2026-07-01T04:00:00.000Z');
const end = new Date('2026-07-29T03:59:59.999Z');

describe('factSheetScopeFromQuery', () => {
  it('preserves every filter that changes the displayed fact sheet', () => {
    const query: AnalyticsQuery = {
      landscapeId: 'landscape',
      start,
      end,
      platforms: ['instagram'],
      companyIds: ['company'],
      tagIds: ['tag'],
      postTypes: ['reel'],
      search: '  elections  ',
      granularity: 'week',
      compare: true,
    };

    assert.deepEqual(factSheetScopeFromQuery(query), {
      platforms: ['instagram'],
      companyIds: ['company'],
      tagIds: ['tag'],
      postTypes: ['reel'],
      search: 'elections',
    });
  });

  it('omits empty filters so an unfiltered request has one canonical shape', () => {
    assert.deepEqual(factSheetScopeFromQuery({
      landscapeId: 'landscape', start, end,
      platforms: [], companyIds: [], tagIds: [], postTypes: [], search: '   ',
    }), {
      platforms: undefined,
      companyIds: undefined,
      tagIds: undefined,
      postTypes: undefined,
      search: undefined,
    });
  });
});

describe('factSheetFingerprint', () => {
  const facts = {
    landscape: { id: 'landscape', name: 'Market', focusCompany: 'Globe' },
    range: { start: '2026-07-01', end: '2026-07-28', days: 28 },
    previousRange: { start: '2026-06-03', end: '2026-06-30' },
    companies: [], leaderboards: {}, focusSummary: null, topPostsOverall: [],
    tagPerformance: [], postTypePerformance: [], notableUrls: [], anomalies: [], caveats: [],
  } satisfies FactSheet;

  it('is deterministic for the same evidence', () => {
    assert.equal(factSheetFingerprint(facts), factSheetFingerprint(structuredClone(facts)));
  });

  it('changes when any displayed evidence changes', () => {
    assert.notEqual(
      factSheetFingerprint(facts),
      factSheetFingerprint({ ...facts, caveats: ['Instagram is incomplete.'] }),
    );
  });
});
