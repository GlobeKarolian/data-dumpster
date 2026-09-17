import { parseLocalDay, parseRangeParams, presetRange } from '@/lib/dates';
import { PLATFORMS, type DateRange } from '@/lib/types';
import type { SortKey } from '@/lib/metrics/contract';

export type V2Path = '/v2' | '/v2/compare' | '/v2/posts';
export type CompareTab = 'publishing' | 'engagement' | 'audience';
export interface V2State {
  landscape: string; range: '7d' | '28d' | '90d' | '24h' | 'custom'; start: string; end: string; at: string;
  platforms: string; companies: string; q: string; sort: SortKey; direction: 'asc' | 'desc';
  page: number; post: string; tab: CompareTab; metric: string; inspect: 'post' | 'performance' | 'comments';
}
export const SORTS: SortKey[] = ['engagementTotal', 'postedAt', 'engagementRateByFollower', 'applause', 'conversation', 'amplification', 'views'];
const unique = (s: string) => [...new Set(s.split(',').filter(Boolean))].sort().join(',');
export function canonicalState(sp: URLSearchParams): V2State {
  const get = (key: string) => sp.get(key) ?? '';
  const start = get('start'), end = get('end');
  const at = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(get('at')) && Number.isFinite(+new Date(get('at'))) ? new Date(get('at')).toISOString() : '';
  const custom = !['7d', '28d', '90d', '24h'].includes(get('range')) && !!parseLocalDay(start) && !!parseLocalDay(end) && start <= end;
  return {
    landscape: get('landscape'), range: get('range') === '24h' && at ? '24h' : custom ? 'custom' : get('range') === '28d' ? '28d' : get('range') === '90d' ? '90d' : '7d',
    start: custom ? start : '', end: custom ? end : '', at,
    platforms: unique(get('platforms')).split(',').filter(p => p !== 'rss' && (PLATFORMS as readonly string[]).includes(p)).join(','),
    companies: unique(get('companies')), q: get('q').trim().slice(0, 300),
    sort: SORTS.includes(get('sort') as SortKey) ? get('sort') as SortKey : 'engagementTotal',
    direction: get('direction') === 'asc' ? 'asc' : 'desc',
    page: /^\d+$/.test(get('page')) ? Math.min(100000, Math.max(1, Number(get('page')))) : 1,
    post: get('post'), tab: get('tab') === 'engagement' ? 'engagement' : get('tab') === 'audience' ? 'audience' : 'publishing',
    metric: get('metric'), inspect: get('inspect') === 'performance' ? 'performance' : get('inspect') === 'comments' ? 'comments' : 'post',
  };
}
export function transitionUrl(path: V2Path, state: V2State, patch: Partial<V2State> = {}): string {
  const next = { ...state, ...patch };
  if (['landscape', 'range', 'start', 'end', 'platforms', 'companies', 'q', 'sort', 'direction'].some(k => k in patch)) {
    next.page = 1; next.post = ''; next.inspect = 'post';
  }
  if ('landscape' in patch) next.companies = '';
  if ('range' in patch && patch.range !== 'custom') { next.start = ''; next.end = ''; }
  const sp = new URLSearchParams();
  for (const k of ['landscape', 'platforms', 'companies'] as const) if (next[k]) sp.set(k, next[k]);
  if (next.range === 'custom') { sp.set('start', next.start); sp.set('end', next.end); }
  else sp.set('range', next.range);
  if (next.range === '24h' && next.at) sp.set('at', next.at);
  if (path === '/v2/posts') {
    if (next.q) sp.set('q', next.q);
    sp.set('sort', next.sort); if (next.direction === 'asc') sp.set('direction', 'asc');
    if (next.page > 1) sp.set('page', String(next.page));
    if (next.post) sp.set('post', next.post);
    if (next.inspect !== 'post') sp.set('inspect', next.inspect);
  }
  if (path === '/v2/compare') { sp.set('tab', next.tab); if (next.metric) sp.set('metric', next.metric); }
  return `${path}?${sp}`;
}
export function rangeFor(state: V2State, today = false, now = new Date()): DateRange {
  if (today) return { start: new Date(+now - 86400000), end: now };
  if (state.range === '24h') { const end = new Date(state.at); return { start: new Date(+end - 86400000), end }; }
  if (state.range === 'custom') return parseRangeParams(new URLSearchParams({ start: state.start, end: state.end }));
  return presetRange(Number(state.range.slice(0, -1)), now);
}
export function scopeMatches(requested: string, landscape: { id: string; slug: string } | null): boolean {
  return !requested || !!landscape && (landscape.id === requested || landscape.slug === requested);
}
