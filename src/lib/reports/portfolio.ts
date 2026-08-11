import type { MetricRow } from '@/lib/types';
import type {
  BrandRow,
  Movement,
  PortfolioPerformance,
} from './types';

/** Keep the owned-brand cohort identical across every portfolio calculation. */
export function ownedMetricRows(
  rows: MetricRow[],
  bgmCompanyIds: ReadonlySet<string>,
): MetricRow[] {
  return rows.filter((row) => bgmCompanyIds.has(row.company.id));
}

/**
 * Add the rows that actually carry a measurement.
 *
 * An unavailable brand is not zero and is therefore excluded rather than
 * silently depressing the portfolio. The report's coverage notes still call
 * out unavailable or partial sources.
 */
export function sumMeasuredValues(rows: MetricRow[]): number | null {
  const measured = rows.filter((row) => row.available && Number.isFinite(row.value));
  if (measured.length === 0) return null;
  return measured.reduce((total, row) => total + row.value, 0);
}

/**
 * Add prior-window values for the same currently measured cohort.
 *
 * If even one contributing brand lacks a complete prior comparison, the
 * portfolio WoW value is withheld. Comparing two differently sized portfolios
 * would manufacture movement that came from coverage rather than performance.
 */
export function sumComparablePrevious(rows: MetricRow[]): number | null {
  const measured = rows.filter((row) => row.available && Number.isFinite(row.value));
  if (
    measured.length === 0
    || measured.some((row) => (
      row.complete === false
      || !row.previousAvailable
      || row.previousComplete === false
      || row.previousValue === null
      || row.previousValue === undefined
      || !Number.isFinite(row.previousValue)
    ))
  ) return null;
  return measured.reduce((total, row) => total + (row.previousValue ?? 0), 0);
}

function legacyMovement(
  value: number | null,
  previousValue: number | null = null,
): Movement {
  const changePct = value === null || previousValue === null || previousValue === 0
    ? null
    : (value - previousValue) / Math.abs(previousValue);
  const direction = changePct === null
    ? 'unknown'
    : Math.abs(changePct) < 0.005
      ? 'flat'
      : changePct > 0 ? 'up' : 'down';
  return {
    value,
    previousValue,
    changePct,
    direction,
  };
}

function sumBrandValues(
  brands: BrandRow[],
  read: (brand: BrandRow) => number | null | undefined,
): number | null {
  const values = brands
    .map(read)
    .filter((value): value is number => typeof value === 'number' && Number.isFinite(value));
  if (values.length === 0) return null;
  return values.reduce((total, value) => total + value, 0);
}

/**
 * Old saved reports used `portfolio` for the whole competitive landscape.
 * Derive current BGM-only totals from their owned brand rows so a public link
 * never relabels a market-wide total as BGM performance. Recompute restores
 * fully comparable prior-week portfolio values.
 */
export function resolveBgmPortfolio(
  portfolio: PortfolioPerformance,
  brands: BrandRow[],
): PortfolioPerformance {
  if (portfolio.scope === 'bgm_owned') return portfolio;

  const ownedBrands = brands.filter((brand) => brand.isBgmOwned);
  const followers = sumBrandValues(ownedBrands, (brand) => brand.totalFollowers);
  const previousFollowers = ownedBrands.length > 0
    && ownedBrands.every((brand) => (
      typeof brand.totalFollowers === 'number'
      && typeof brand.previousTotalFollowers === 'number'
    ))
    ? sumBrandValues(ownedBrands, (brand) => brand.previousTotalFollowers)
    : null;
  const engagement = sumBrandValues(ownedBrands, (brand) => brand.engagementTotal);
  const posts = sumBrandValues(ownedBrands, (brand) => brand.posts);
  const engagementPerPost = engagement !== null && posts !== null && posts > 0
    ? engagement / posts
    : null;

  return {
    scope: 'bgm_owned',
    followers: legacyMovement(followers, previousFollowers),
    netFollowers: sumBrandValues(ownedBrands, (brand) => brand.netChange),
    previousNetFollowers: null,
    engagementTotal: legacyMovement(engagement),
    posts: legacyMovement(posts),
    engagementPerPost: legacyMovement(engagementPerPost),
  };
}
