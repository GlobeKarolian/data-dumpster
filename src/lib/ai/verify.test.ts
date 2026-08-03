import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  indexMaterialNumbers,
  verifyBrief,
  verifyNumbersAgainstMaterial,
  indexFactNumbers,
} from './verify';
import type { FactSheet, HeadlineStat } from '@/lib/metrics/contract';
import type { MetricKey } from '@/lib/types';

function headline(key: MetricKey, value: number): HeadlineStat {
  return {
    key,
    value,
    available: true,
    previousValue: null,
    previousAvailable: false,
    changePct: null,
    spark: [],
  };
}

describe('verifyNumbersAgainstMaterial', () => {
  it('grounds every figure against the rendered source precision', () => {
    const material = 'Engagement was 1.2M, the rate was 27.3%, and cost was $3.40.';
    const result = verifyNumbersAgainstMaterial(
      'Engagement reached 1.2M at a 27.3% rate and $3.40 cost.',
      material,
    );

    assert.equal(result.ok, true);
    assert.equal(result.stats.total, 3);
    assert.equal(result.stats.grounded, 3);
  });

  it('rejects a more precise figure that the rendered material does not support', () => {
    const inventedDetail = verifyNumbersAgainstMaterial(
      'Engagement reached 1,234,567.',
      'Engagement was 1.2M.',
    );
    const expandedRounding = verifyNumbersAgainstMaterial(
      'Engagement reached 1,200,000.',
      'Engagement was 1.2M.',
    );

    assert.equal(inventedDetail.ok, false);
    assert.equal(expandedRounding.ok, false);
    assert.deepEqual(
      inventedDetail.claims.filter((claim) => !claim.found).map((claim) => claim.raw),
      ['1,234,567'],
    );
  });

  it('checks all claims and reports the unmatched ones', () => {
    const result = verifyNumbersAgainstMaterial(
      'There were 41,208 engagements across 99 posts at 416 per post.',
      'Engagements: 41,208. Posts: 100. Engagement per post: 412.',
    );

    assert.equal(result.ok, false);
    assert.equal(result.stats.total, 3);
    assert.equal(result.stats.grounded, 1);
    assert.deepEqual(
      result.claims.filter((claim) => !claim.found).map((claim) => claim.raw),
      ['99', '416'],
    );
  });

  it('does not treat report dates as quantitative source facts or prose claims', () => {
    const material = 'Window 7/20/2026 - 7/26/2026, previous 2026-07-13 to 2026-07-19.';
    assert.deepEqual(indexMaterialNumbers(material), []);

    const result = verifyNumbersAgainstMaterial(
      'The window ran from 7/20/2026 through 7/26/2026.',
      material,
    );
    assert.equal(result.ok, true);
    assert.equal(result.stats.total, 0);
  });

  it('rejects runaway percentages even when copied from manual material', () => {
    const result = verifyNumbersAgainstMaterial(
      'The rate increased 1,200%.',
      'Manual rate: 1,200%.',
    );

    assert.equal(result.ok, false);
    assert.equal(result.stats.grounded, 1);
    assert.match(result.violations[0] ?? '', /near-zero baseline/);
  });

  it('does not ground invented percent or currency units with a plain number', () => {
    const material = 'Rank: 5. Conversion rate: 8%. Cost per start: $12.00.';

    const inventedPercent = verifyNumbersAgainstMaterial(
      'The conversion rate was 5%.',
      material,
    );
    const droppedPercent = verifyNumbersAgainstMaterial(
      'The conversion rate was 8.',
      material,
    );
    const droppedCurrency = verifyNumbersAgainstMaterial(
      'Cost per start was 12.00.',
      material,
    );

    assert.equal(inventedPercent.ok, false);
    assert.equal(droppedPercent.ok, false);
    assert.equal(droppedCurrency.ok, false);
  });

  it('does not equate rendered percentages that are 100 times apart', () => {
    const understated = verifyNumbersAgainstMaterial(
      'The engagement rate was 0.5%.',
      'Engagement rate: 50%.',
    );
    const overstated = verifyNumbersAgainstMaterial(
      'The engagement rate was 50%.',
      'Engagement rate: 0.5%.',
    );

    assert.equal(understated.ok, false);
    assert.equal(overstated.ok, false);
    assert.equal(verifyNumbersAgainstMaterial(
      'The engagement rate was 50%.',
      'Engagement rate: 50%.',
    ).ok, true);
  });

  it('checks bare year-shaped metrics while ignoring syntactically temporal years', () => {
    const quantitative = verifyNumbersAgainstMaterial(
      'The post earned 2026 engagements.',
      'The post earned 412 engagements.',
    );
    const temporal = verifyNumbersAgainstMaterial(
      'In 2026, the post earned 412 engagements.',
      'The post earned 412 engagements.',
    );
    const ambiguousPreposition = verifyNumbersAgainstMaterial(
      'The post increased by 2026 engagements.',
      'The post increased by 412 engagements.',
    );

    assert.equal(quantitative.ok, false);
    assert.equal(quantitative.stats.total, 1);
    assert.deepEqual(
      quantitative.claims.filter((claim) => !claim.found).map((claim) => claim.raw),
      ['2026'],
    );
    assert.equal(temporal.ok, true);
    assert.equal(temporal.stats.total, 1);
    assert.equal(ambiguousPreposition.ok, false);
    assert.deepEqual(
      ambiguousPreposition.claims
        .filter((claim) => !claim.found)
        .map((claim) => claim.raw),
      ['2026'],
    );
  });
});

describe('verifyBrief', () => {
  it('keeps citation and caveat enforcement while sharing numeric grounding', () => {
    const facts: FactSheet = {
      landscape: { id: 'landscape-1', name: 'Example', focusCompany: null },
      range: { start: '2026-07-20', end: '2026-07-26', days: 7 },
      previousRange: { start: '2026-07-13', end: '2026-07-19' },
      companies: [],
      leaderboards: {},
      focusSummary: null,
      topPostsOverall: [],
      tagPerformance: [],
      postTypePerformance: [],
      notableUrls: [],
      anomalies: [],
      caveats: ['Coverage includes only 3 complete days.'],
    };
    const result = verifyBrief(
      'The window covers 7 days [facts.range.days]. Coverage includes only 3 complete days.',
      facts,
    );

    assert.equal(result.ok, true);
    assert.deepEqual(result.stats, { total: 2, grounded: 2, cited: 1 });
    assert.deepEqual(result.missingCaveats, []);
  });

  it('still accepts percentage prose backed by a fractional fact-sheet value', () => {
    const facts: FactSheet = {
      landscape: { id: 'landscape-1', name: 'Example', focusCompany: null },
      range: { start: '2026-07-20', end: '2026-07-26', days: 7 },
      previousRange: { start: '2026-07-13', end: '2026-07-19' },
      companies: [],
      leaderboards: {},
      focusSummary: {
        focus: null,
        range: { start: '2026-07-20', end: '2026-07-26' },
        previousRange: { start: '2026-07-13', end: '2026-07-19' },
        headline: {
          audience: headline('audience', 0),
          posts: headline('posts', 0),
          engagementTotal: headline('engagementTotal', 0),
          engagementRateByFollower: headline('engagementRateByFollower', 0.5),
        },
        topPlatform: null,
        platformMix: [],
        topPosts: [],
        landscapeTotals: { posts: 0, engagementTotal: 0, audience: 0 },
      },
      topPostsOverall: [],
      tagPerformance: [],
      postTypePerformance: [],
      notableUrls: [],
      anomalies: [],
      caveats: [],
    };
    const result = verifyBrief(
      'The engagement rate was 50% '
        + '[facts.focusSummary.headline.engagementRateByFollower.value].',
      facts,
    );

    assert.equal(result.ok, true);
    assert.equal(result.stats.grounded, 1);
  });

  it('does not let an equal count or rank ground an invented percentage', () => {
    const facts: FactSheet = {
      landscape: { id: 'landscape-1', name: 'Example', focusCompany: null },
      range: { start: '2026-07-20', end: '2026-07-26', days: 50 },
      previousRange: { start: '2026-07-13', end: '2026-07-19' },
      companies: [],
      leaderboards: {},
      focusSummary: null,
      topPostsOverall: [],
      tagPerformance: [],
      postTypePerformance: [],
      notableUrls: [],
      anomalies: [],
      caveats: [],
    };
    const result = verifyBrief(
      'The rate was 50% [facts.range.days].',
      facts,
    );

    assert.equal(result.ok, false);
    assert.equal(result.claims[0]?.found, false);
  });
});

describe('unmeasured rows are not grounds for a claim', () => {
  it('does not index a value the prompt suppressed', () => {
    // A leaderboard row with no audience data still carries value 0 in the
    // fact sheet. The model never sees it. Before this, a sentence inventing
    // "flat at 0" matched the index and was reported as verified.
    const facts = {
      leaderboards: {
        audience: [
          { company: { id: 'a', name: 'Alpha' }, value: 0, rank: 0, available: false },
          { company: { id: 'b', name: 'Beta' }, value: 12345, rank: 1, available: true },
        ],
      },
    } as unknown as Parameters<typeof indexFactNumbers>[0];

    const index = indexFactNumbers(facts);
    const values = index.map((e) => e.value);
    assert.ok(values.includes(12345), 'the measured value must still be groundable');
    assert.ok(!index.some((e) => e.path.includes('[0].value')),
      'a suppressed value must not be groundable');
    assert.ok(!index.some((e) => e.path.includes('[0].rank')),
      'a suppressed rank must not be groundable');
  });

  it('suppresses previousValue when the prior window was unmeasured', () => {
    const facts = {
      leaderboards: {
        audience: [
          { company: { id: 'a', name: 'Alpha' }, value: 500, previousValue: 0,
            available: true, previousAvailable: false },
        ],
      },
    } as unknown as Parameters<typeof indexFactNumbers>[0];
    const index = indexFactNumbers(facts);
    assert.ok(index.some((e) => e.value === 500));
    assert.ok(!index.some((e) => e.path.includes('previousValue')));
  });
});
