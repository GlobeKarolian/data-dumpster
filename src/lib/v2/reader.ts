import type { AppContext } from '@/app/(app)/_lib/context';
import type { SearchParamsInput } from '@/app/(app)/_lib/data';
import type { AnalyticsQuery, MetricKey, MetricRow, Paged, Platform } from '@/lib/types';
import type { PostDto, PostDetailDto, PostsQuery } from '@/lib/metrics/contract';
import type { IngestionCoverage, IngestionCoverageQuery } from '@/lib/metrics/ingestion-coverage';
import { canonicalState, rangeFor, scopeMatches, type CompareTab } from './state';

export const COMPARE_METRICS: Record<CompareTab, MetricKey[]> = {
  publishing: ['posts', 'postsPerDay'],
  engagement: ['engagementTotal', 'engagementPerPost', 'engagementRateByFollower'],
  audience: ['audience'],
};
type Scoped<Q> = Q & { orgId: string };
export interface ReadDependencies {
  context(input: SearchParamsInput): Promise<AppContext>;
  posts(q: Scoped<PostsQuery>): Promise<Paged<PostDto>>;
  leaderboard(q: Scoped<AnalyticsQuery> & { metric: MetricKey }): Promise<MetricRow[]>;
  coverage(q: IngestionCoverageQuery): Promise<IngestionCoverage | null>;
  detail(q: Scoped<PostsQuery> & { postId: string }): Promise<PostDetailDto | null>;
}
export class ScopeUnavailable extends Error { constructor() { super('Scope unavailable'); } }
export function createReader(deps: ReadDependencies) {
  return async function read(mode: 'today' | 'compare' | 'posts', input: SearchParamsInput, now = new Date()) {
    const sp = new URLSearchParams();
    for (const [k, v] of Object.entries(input)) if (v !== undefined) sp.set(k, Array.isArray(v) ? v[0] ?? '' : v);
    const state = canonicalState(sp);
    // Context is the existing session + per-user visibility boundary. Do not pass
    // hidden legacy filters that V2 cannot show or explain.
    const ctx = await deps.context({ landscape: state.landscape });
    if (ctx.error) throw new Error('Unable to read the selected workspace.');
    if (!scopeMatches(state.landscape, ctx.landscape)) throw new ScopeUnavailable();
    const companyIds = state.companies.split(',').filter(Boolean);
    if (companyIds.some(id => !ctx.companies.some(c => c.id === id))) throw new ScopeUnavailable();
    state.landscape = ctx.landscape?.id ?? '';
    const range = rangeFor(state, mode === 'today', now);
    const metrics = COMPARE_METRICS[state.tab];
    const metric = metrics.includes(state.metric as MetricKey) ? state.metric as MetricKey : metrics[0];
    state.metric = metric;
    const query: Scoped<PostsQuery> = {
      orgId: ctx.orgId, landscapeId: state.landscape, ...range,
      platforms: state.platforms ? state.platforms.split(',') as Platform[] : undefined,
      companyIds: companyIds.length ? companyIds : undefined,
      search: mode === 'posts' ? state.q || undefined : undefined,
      compare: mode === 'compare' && state.range !== '24h', sort: mode === 'today' ? 'engagementTotal' : state.sort,
      direction: mode === 'today' ? 'desc' : state.direction, page: state.page, pageSize: mode === 'today' ? 12 : 25,
    };
    let posts: Paged<PostDto> | null = null;
    let rows: MetricRow[] = [];
    let coverage: IngestionCoverage | null = null;
    let detail: PostDetailDto | null = null;
    if (ctx.landscape) {
      [posts, rows, coverage] = await Promise.all([
        mode !== 'compare' ? deps.posts({ ...query, page: mode === 'today' ? 1 : state.page }) : null,
        mode !== 'posts' ? deps.leaderboard({ ...query, metric: mode === 'today' ? 'posts' : metric, compare: mode === 'compare' && state.range !== '24h' }) : [],
        deps.coverage({ ...query, focusCompanyId: ctx.focusCompanyId }),
      ]);
      if (mode === 'posts' && posts) {
        // The legacy window-count query loses total_count when OFFSET returns
        // no rows. Recover it from page one before deciding the final page.
        if (state.page > 1 && posts.items.length === 0 && posts.total === 0) posts = await deps.posts({ ...query, page: 1 });
        const last = Math.max(1, Math.ceil(posts.total / posts.pageSize));
        state.page = Math.min(state.page, last);
        if (posts.page !== state.page) posts = await deps.posts({ ...query, page: state.page });
        if (state.post && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(state.post)) {
          detail = await deps.detail({ ...query, postId: state.post });
          // Never serialize an unverified generated comment summary to the client.
          if (detail) detail = { ...detail, comments: { ...detail.comments, summary: null } };
        }
      }
    }
    return { ctx, state, range, metric, posts, rows, coverage, detail };
  };
}
export type V2Data = Awaited<ReturnType<ReturnType<typeof createReader>>>;
