import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { MetricRow } from '@/lib/types';
import type { PortfolioPerformance } from './types';
import {
  ownedMetricRows,
  resolveBgmPortfolio,
  sumComparablePrevious,
  sumMeasuredValues,
} from './portfolio';

function row({
  id,
  value,
  available = true,
  complete = true,
  previousValue = 0,
  previousAvailable = true,
  previousComplete = true,
}: {
  id: string;
  value: number;
  available?: boolean;
  complete?: boolean;
  previousValue?: number | null;
  previousAvailable?: boolean;
  previousComplete?: boolean;
}): MetricRow {
  return {
    company: { id, name: id, slug: id },
    value,
    available,
    complete,
    previousValue,
    previousAvailable,
    previousComplete,
    rank: 1,
  };
}

describe('BGM portfolio aggregation', () => {
  it('filters the market board to BGM companies and sums every measured row', () => {
    const market = [
      row({ id: 'globe', value: 100, previousValue: 80 }),
      row({ id: 'boston', value: 50, previousValue: 40 }),
      row({ id: 'competitor', value: 900, previousValue: 700 }),
      row({ id: 'unavailable-owned', value: 400, available: false }),
    ];
    const owned = ownedMetricRows(
      market,
      new Set(['globe', 'boston', 'unavailable-owned']),
    );

    assert.deepEqual(owned.map((item) => item.company.id), [
      'globe',
      'boston',
      'unavailable-owned',
    ]);
    assert.equal(sumMeasuredValues(owned), 150);
    assert.equal(sumComparablePrevious(owned), 120);
  });

  it('withholds WoW when a contributing brand is partial or lacks a prior value', () => {
    assert.equal(sumComparablePrevious([
      row({ id: 'globe', value: 100, previousValue: 80 }),
      row({ id: 'boston', value: 50, previousValue: 40, complete: false }),
    ]), null);

    assert.equal(sumComparablePrevious([
      row({ id: 'globe', value: 100, previousValue: 80 }),
      row({ id: 'boston', value: 50, previousAvailable: false }),
    ]), null);
  });

  it('derives safe BGM-only current totals for legacy saved reports', () => {
    const legacyMarketPortfolio: PortfolioPerformance = {
      followers: { value: 999, previousValue: 900, changePct: 0.11, direction: 'up' },
      netFollowers: 99,
      engagementTotal: { value: 800, previousValue: 700, changePct: 0.14, direction: 'up' },
      posts: { value: 80, previousValue: 70, changePct: 0.14, direction: 'up' },
      engagementPerPost: { value: 10, previousValue: 10, changePct: 0, direction: 'flat' },
    };

    const resolved = resolveBgmPortfolio(legacyMarketPortfolio, [
      {
        companyId: 'globe',
        name: 'The Boston Globe',
        isBgmOwned: true,
        rank: 1,
        totalFollowers: 100,
        previousTotalFollowers: 90,
        netChange: 10,
        changePct: null,
        byPlatform: {},
        posts: 5,
        engagementTotal: 50,
      },
      {
        companyId: 'competitor',
        name: 'Competitor',
        isBgmOwned: false,
        rank: 2,
        totalFollowers: 899,
        previousTotalFollowers: 810,
        netChange: 89,
        changePct: null,
        byPlatform: {},
        posts: 75,
        engagementTotal: 750,
      },
    ]);

    assert.equal(resolved.scope, 'bgm_owned');
    assert.equal(resolved.followers.value, 100);
    assert.equal(resolved.followers.previousValue, 90);
    assert.equal(resolved.netFollowers, 10);
    assert.equal(resolved.engagementTotal.value, 50);
    assert.equal(resolved.posts.value, 5);
    assert.equal(resolved.engagementPerPost.value, 10);
    assert.equal(resolved.engagementTotal.previousValue, null);
  });
});
