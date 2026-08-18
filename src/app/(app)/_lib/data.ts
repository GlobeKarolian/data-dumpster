import type { AnalyticsQuery, MetricKey, Platform } from '@/lib/types';
import type {
  FactSheet, MetricsApi, PostsQuery, SummaryResult, TopPostsQuery,
} from '@/lib/metrics/contract';
import type {
  IngestionCoverage,
  IngestionCoverageQuery,
} from '@/lib/metrics/ingestion-coverage';

export type SearchParamsInput = Record<string, string | string[] | undefined>;

export interface Loaded<T> {
  data: T;
  /** Present when the query threw. Panels render an error rather than a zero. */
  error: string | null;
}

/**
 * Server Components call the query engine directly, but a failed query must not
 * take a whole screen down with it. Each panel loads independently and, when it
 * cannot, says so in place instead of rendering a confident zero. A blank that
 * explains itself is worth more than a number nobody can defend.
 */
export async function tryQuery<T>(fn: () => Promise<T>, fallback: T): Promise<Loaded<T>> {
  try {
    return { data: await fn(), error: null };
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown query failure';
    console.error('[pressbox] query failed:', message);
    return { data: fallback, error: message };
  }
}

/**
 * The query engine is imported lazily so that a missing DATABASE_URL degrades
 * into an empty, explanatory screen instead of a module-load crash during
 * build. Nothing else in the app should import queries.ts directly.
 */
export async function metricsApi(): Promise<MetricsApi> {
  const mod = await import('@/lib/metrics/queries');
  return mod.metrics;
}

export type ScopedQuery = AnalyticsQuery & { orgId?: string };

export async function loadSummary(q: ScopedQuery): Promise<Loaded<SummaryResult | null>> {
  return tryQuery<SummaryResult | null>(async () => {
    const api = await metricsApi();
    return api.getSummary(q);
  }, null);
}

export async function loadLeaderboard(q: ScopedQuery & { metric: MetricKey }) {
  return tryQuery(async () => {
    const api = await metricsApi();
    return api.getLeaderboard(q);
  }, []);
}

export async function loadIngestionCoverage(
  q: IngestionCoverageQuery,
): Promise<Loaded<IngestionCoverage | null>> {
  return tryQuery<IngestionCoverage | null>(async () => {
    const { getIngestionCoverage } = await import('@/lib/metrics/ingestion-coverage');
    return getIngestionCoverage(q);
  }, null);
}

export async function loadTimeSeries(q: ScopedQuery & { metric: MetricKey }) {
  return tryQuery(
    async () => {
      const api = await metricsApi();
      return api.getTimeSeries(q);
    },
    { series: [], companies: [], granularity: 'day' as const },
  );
}

export async function loadPosts(q: PostsQuery & { orgId?: string }) {
  return tryQuery(
    async () => {
      const api = await metricsApi();
      return api.getPosts(q);
    },
    { items: [], total: 0, page: 1, pageSize: q.pageSize ?? 25 },
  );
}

export async function loadTopPostsByPlatform(q: TopPostsQuery & { orgId?: string }) {
  return tryQuery(async () => {
    const api = await metricsApi();
    return api.getTopPostsByPlatform(q);
  }, []);
}

export async function loadPostedUrls(q: ScopedQuery & { groupBy?: 'domain' | 'url' }) {
  return tryQuery(async () => {
    const api = await metricsApi();
    return api.getPostedUrls(q);
  }, []);
}

export async function loadTagPerformance(q: ScopedQuery) {
  return tryQuery(async () => {
    const api = await metricsApi();
    return api.getTagPerformance(q);
  }, []);
}

export async function loadTagSeries(q: ScopedQuery) {
  return tryQuery(async () => {
    const api = await metricsApi();
    return api.getTagSeries(q);
  }, []);
}

export async function loadPostTypePerformance(q: ScopedQuery) {
  return tryQuery(async () => {
    const api = await metricsApi();
    return api.getPostTypePerformance(q);
  }, []);
}

export async function loadPostingCadence(q: ScopedQuery) {
  return tryQuery(async () => {
    const api = await metricsApi();
    return api.getPostingCadence(q);
  }, []);
}

/**
 * Vendor-reported history for periods we never collected ourselves.
 *
 * Kept out of loadTimeSeries on purpose: these numbers are a third party's
 * arithmetic and must stay visibly separate from anything this product
 * computed, so the caller has to ask for them by name.
 */
export async function loadExternalHistory(q: {
  companyIds: string[];
  metric: string;
  start: Date;
  end: Date;
  platforms?: Platform[];
}) {
  return tryQuery(
    async () => {
      const { getExternalBrandHistory } = await import('@/lib/metrics/external-history');
      return getExternalBrandHistory(q);
    },
    { series: [], sources: [], earliest: null as string | null, latest: null as string | null },
  );
}

export async function loadFactSheet(q: ScopedQuery): Promise<Loaded<FactSheet | null>> {
  return tryQuery<FactSheet | null>(async () => {
    const api = await metricsApi();
    return api.getFactSheet(q);
  }, null);
}

/** Raw SQL escape hatch for the settings screens, which are not analytics. */
export async function query<Row extends Record<string, unknown>>(
  build: (helpers: { sql: typeof import('drizzle-orm').sql }) => import('drizzle-orm').SQL,
): Promise<Loaded<Row[]>> {
  return tryQuery<Row[]>(async () => {
    const [{ db }, drizzle] = await Promise.all([import('@/db'), import('drizzle-orm')]);
    const result = await db.execute<Row>(build({ sql: drizzle.sql }));
    return [...result.rows];
  }, []);
}
