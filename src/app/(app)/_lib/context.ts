import { PLATFORMS, POST_TYPES, type CompanyRef, type Platform, type PostType } from '@/lib/types';
import { autoGranularity, daysIn, parseRangeParams, previousRange } from '@/lib/dates';
import type { AnalyticsQuery, DateRange } from '@/lib/types';
import { roleAtLeast, type Role } from '@/lib/roles';
import { companiesInScope, effectiveFocusCompanyId } from '@/lib/analytics-scope';
import type { LandscapeOption } from '@/components/shell/landscape-switcher';
import { query, type SearchParamsInput } from './data';

export interface LandscapeRecord extends LandscapeOption {
  focusCompanyId: string | null;
  slug: string;
}

export interface AppContext {
  orgId: string;
  userId: string;
  role: Role;
  landscapes: LandscapeRecord[];
  landscape: LandscapeRecord | null;
  companies: CompanyRef[];
  focusCompanyId: string | null;
  range: DateRange;
  previous: DateRange;
  days: number;
  granularity: 'day' | 'week' | 'month';
  platforms: Platform[];
  companyIds: string[];
  postTypes: PostType[];
  tagIds: string[];
  search: string;
  searchParams: URLSearchParams;
  /** Non-null when the landscape list itself could not be read. */
  error: string | null;
}

export function toUrlSearchParams(input: SearchParamsInput): URLSearchParams {
  const sp = new URLSearchParams();
  for (const [key, value] of Object.entries(input)) {
    if (value === undefined) continue;
    if (Array.isArray(value)) value.forEach((v) => sp.append(key, v));
    else sp.set(key, value);
  }
  return sp;
}

function list(sp: URLSearchParams, key: string): string[] {
  const raw = sp.get(key);
  if (!raw) return [];
  return raw.split(',').map((s) => s.trim()).filter(Boolean);
}

const PLATFORM_SET = new Set<string>(PLATFORMS);
const POST_TYPE_SET = new Set<string>(POST_TYPES);

type LandscapeRow = {
  id: string;
  name: string;
  slug: string;
  focus_company_id: string | null;
  focus_company_name: string | null;
  company_count: number | string;
}

type CompanyRow = {
  id: string;
  name: string;
  slug: string;
  logo_url: string | null;
  color: string | null;
  segment: string | null;
}

/**
 * Resolves everything a screen needs before it can ask a question: which org,
 * which landscape, which window, and which slice of it. Doing this once per
 * page keeps the query shape identical across screens, which is the only
 * reason the numbers on two different screens can be trusted to agree.
 */
export async function resolveContext(input: SearchParamsInput): Promise<AppContext> {
  const { requireOrg } = await import('@/lib/session');
  const session = await requireOrg();
  const sp = toUrlSearchParams(input);

  const landscapesResult = await query<LandscapeRow>(({ sql }) => sql`
    SELECT l.id,
           l.name,
           l.slug,
           l.focus_company_id,
           fc.name AS focus_company_name,
           count(lc.company_id) AS company_count
      FROM landscapes l
      LEFT JOIN companies fc ON fc.id = l.focus_company_id
      LEFT JOIN landscape_companies lc ON lc.landscape_id = l.id
     WHERE l.org_id = ${session.orgId}::uuid
       AND (
         ${roleAtLeast(session.role, 'admin')}
         OR EXISTS (
           SELECT 1
             FROM user_landscape_access ula
            WHERE ula.landscape_id = l.id
              AND ula.user_id = ${session.userId}::uuid
         )
       )
     GROUP BY l.id, l.name, l.slug, l.focus_company_id, fc.name
     ORDER BY l.name ASC
  `);

  const landscapes: LandscapeRecord[] = landscapesResult.data.map((r) => ({
    id: r.id,
    name: r.name,
    slug: r.slug,
    focusCompanyId: r.focus_company_id,
    focusCompanyName: r.focus_company_name,
    companyCount: Number(r.company_count) || 0,
  }));

  const requested = sp.get('landscape');
  const landscape =
    landscapes.find((l) => l.id === requested) ??
    landscapes.find((l) => l.slug === requested) ??
    landscapes[0] ??
    null;

  const companiesResult = landscape
    ? await query<CompanyRow>(({ sql }) => sql`
        -- The org-scoped landscape membership is the boundary. A pooled
        -- company's org_id is attribution only.
        SELECT c.id, c.name, c.slug, c.logo_url, c.color, c.segment
          FROM landscape_companies lc
          JOIN companies c ON c.id = lc.company_id
         WHERE lc.landscape_id = ${landscape.id}::uuid
         ORDER BY lc.sort_order ASC, c.name ASC
      `)
    : { data: [] as CompanyRow[], error: null };

  const companies: CompanyRef[] = companiesResult.data.map((c) => ({
    id: c.id,
    name: c.name,
    slug: c.slug,
    logoUrl: c.logo_url,
    color: c.color,
    segment: c.segment,
  }));

  const range = parseRangeParams(sp);
  const validIds = new Set(companies.map((c) => c.id));

  return {
    orgId: session.orgId,
    userId: session.userId,
    role: session.role,
    landscapes,
    landscape,
    companies,
    focusCompanyId: landscape?.focusCompanyId ?? null,
    range,
    previous: previousRange(range),
    days: daysIn(range),
    granularity: autoGranularity(range),
    platforms: list(sp, 'platforms').filter((p): p is Platform => PLATFORM_SET.has(p)),
    companyIds: list(sp, 'companies').filter((id) => validIds.has(id)),
    postTypes: list(sp, 'types').filter((t): t is PostType => POST_TYPE_SET.has(t)),
    tagIds: list(sp, 'tags'),
    search: sp.get('q') ?? '',
    searchParams: sp,
    error: landscapesResult.error ?? companiesResult.error,
  };
}

/** The analytics query implied by the current context, with deltas turned on. */
export function analyticsQuery(
  ctx: AppContext,
  overrides?: Partial<AnalyticsQuery> & { orgId?: string },
): AnalyticsQuery & { orgId?: string } {
  return {
    landscapeId: ctx.landscape?.id ?? '',
    orgId: ctx.orgId,
    start: ctx.range.start,
    end: ctx.range.end,
    platforms: ctx.platforms.length > 0 ? ctx.platforms : undefined,
    companyIds: ctx.companyIds.length > 0 ? ctx.companyIds : undefined,
    tagIds: ctx.tagIds.length > 0 ? ctx.tagIds : undefined,
    postTypes: ctx.postTypes.length > 0 ? ctx.postTypes : undefined,
    search: ctx.search || undefined,
    granularity: ctx.granularity,
    compare: true,
    ...overrides,
  };
}

/** The company list as chart series definitions, focus first and in accent. */
export function seriesFor(ctx: AppContext): { key: string; label: string; color: string; emphasis?: boolean }[] {
  const focusCompanyId = effectiveFocusCompanyId(ctx.focusCompanyId, ctx.companyIds);
  const ordered = companiesInScope(ctx.companies, ctx.companyIds).sort((a, b) => {
    if (a.id === focusCompanyId) return -1;
    if (b.id === focusCompanyId) return 1;
    return a.name.localeCompare(b.name);
  });
  return ordered.map((c, i) => ({
    key: c.id,
    label: c.name,
    color: c.id === focusCompanyId ? '#C8102E' : (c.color ?? PALETTE[i % PALETTE.length]),
    emphasis: c.id === focusCompanyId,
  }));
}

const PALETTE = [
  '#2563EB', '#0D9488', '#D97706', '#7C3AED', '#DB2777',
  '#65A30D', '#0891B2', '#B45309', '#4F46E5', '#BE123C',
];
