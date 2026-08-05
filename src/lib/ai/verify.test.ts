import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  indexMaterialNumbers,
  verifyBrief,
  verifyFactSheetAnswer,
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

function factsWithPostsRow(
  value: number,
  previousValue: number | null = null,
  changePct: number | null = null,
): FactSheet {
  return {
    landscape: { id: 'landscape-1', name: 'Example', focusCompany: 'Alpha' },
    range: { start: '2026-07-20', end: '2026-07-26', days: 7 },
    previousRange: { start: '2026-07-13', end: '2026-07-19' },
    companies: [{ id: 'alpha', name: 'Alpha', slug: 'alpha' }],
    leaderboards: {
      posts: [{
        company: { id: 'alpha', name: 'Alpha', slug: 'alpha' },
        value,
        available: true,
        previousValue,
        previousAvailable: previousValue !== null,
        changePct,
        rank: 1,
      }],
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
    const lowerBoundary = verifyNumbersAgainstMaterial(
      'The rate changed -95%.',
      'Manual rate: -95%.',
    );

    assert.equal(result.ok, false);
    assert.equal(result.stats.grounded, 1);
    assert.match(result.violations[0] ?? '', /near-zero baseline/);
    assert.equal(lowerBoundary.ok, true);
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
  it('keeps citation and qualitative caveat enforcement while sharing numeric grounding', () => {
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
      'The window covers 7 days [facts.range.days]. Coverage includes too few complete days.',
      facts,
    );

    assert.equal(result.ok, true);
    assert.deepEqual(result.stats, { total: 1, grounded: 1, cited: 1 });
    assert.deepEqual(result.missingCaveats, []);
  });

  it('does not let a number inside a caveat ground an unrelated uncited claim', () => {
    const facts = factsWithPostsRow(7);
    facts.caveats = ['Coverage includes only 3 complete days.'];

    const result = verifyBrief(
      'Alpha published 3 posts. Coverage includes only 3 complete days.',
      facts,
    );

    assert.equal(result.ok, false);
    assert.equal(result.stats.total, 2);
    assert.equal(result.stats.grounded, 0);
    assert.equal(result.unverified.length, 2);
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

  it('parses and verifies complete citation paths containing array indexes', () => {
    const facts = factsWithPostsRow(12);

    const result = verifyBrief(
      'Alpha published 12 posts [facts.leaderboards.posts[0].value].',
      facts,
    );

    assert.equal(result.ok, true);
    assert.equal(result.claims[0]?.citedPath, 'facts.leaderboards.posts[0].value');
    assert.equal(result.claims[0]?.matchedPath, 'facts.leaderboards.posts[0].value');
  });

  it('rejects an equal-valued citation for a different kind of fact', () => {
    const facts = factsWithPostsRow(7);

    const wrongPath = verifyBrief(
      'The company published 7 posts [facts.range.days].',
      facts,
    );
    const rightPath = verifyBrief(
      'The company published 7 posts [facts.leaderboards.posts[0].value].',
      facts,
    );

    assert.equal(wrongPath.ok, false);
    assert.equal(wrongPath.claims[0]?.found, true);
    assert.match(wrongPath.miscited[0] ?? '', /describes days.*claim describes posts/);
    assert.equal(rightPath.ok, true);
  });

  it('binds multiple citations to claims in the same order as the prompt', () => {
    const facts = factsWithPostsRow(7);

    const result = verifyBrief(
      'The window covered 7 days and Alpha published 7 posts '
        + '[facts.leaderboards.posts[0].value] [facts.range.days].',
      facts,
    );

    assert.equal(result.ok, false);
    assert.equal(result.miscited.length, 2);
  });

  it('enforces both percentage guardrails from the generation prompt', () => {
    const facts = factsWithPostsRow(1, 100, -0.99);

    const result = verifyBrief(
      'Publishing changed -99% [facts.leaderboards.posts[0].changePct].',
      facts,
    );

    assert.equal(result.claims[0]?.found, true);
    assert.equal(result.miscited.length, 0);
    assert.equal(result.ok, false);
    assert.match(result.violations[0] ?? '', /near-zero baseline/);
  });
});

describe('verifyFactSheetAnswer', () => {
  it('fails closed on an uncited or semantically miscited answer', () => {
    const facts = factsWithPostsRow(7);

    assert.equal(verifyFactSheetAnswer('Alpha published 7 posts.', facts).ok, false);
    assert.equal(verifyFactSheetAnswer(
      'Alpha published 7 posts [facts.range.days].',
      facts,
    ).ok, false);
    assert.equal(verifyFactSheetAnswer(
      'Alpha published 7 posts [facts.leaderboards.posts[0].value].',
      facts,
    ).ok, true);
  });

  it('does not require an unrelated caveat in a short answer', () => {
    const facts = factsWithPostsRow(7);
    facts.caveats = ['Instagram audience history is incomplete.'];

    const result = verifyFactSheetAnswer(
      'Alpha published 7 posts [facts.leaderboards.posts[0].value].',
      facts,
    );

    assert.equal(result.ok, true);
  });

  it('rejects spelled-out quantities that would bypass digit extraction', () => {
    const facts = factsWithPostsRow(7);
    const result = verifyFactSheetAnswer(
      'Alpha published seven posts [facts.leaderboards.posts[0].value].',
      facts,
    );

    assert.equal(result.ok, false);
    assert.equal(result.stats.total, 0);
    assert.match(result.violations[0] ?? '', /Spelled-out quantity/);
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

  it('does not index a platform breakdown the prompt hid', () => {
    const facts = {
      leaderboards: {
        posts: [{
          company: { id: 'a', name: 'Alpha' },
          value: 12,
          available: true,
          rank: 1,
          breakdown: { instagram: 12, youtube: 999 },
          breakdownAvailability: { instagram: true, youtube: false },
        }],
      },
    } as unknown as Parameters<typeof indexFactNumbers>[0];

    const index = indexFactNumbers(facts);

    assert.ok(index.some((entry) => entry.path.endsWith('breakdown.instagram')));
    assert.ok(!index.some((entry) => entry.path.endsWith('breakdown.youtube')));
  });
});
