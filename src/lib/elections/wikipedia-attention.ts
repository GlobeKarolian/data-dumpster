/**
 * Wikipedia lookup attention for election candidates.
 *
 * What this measures, said precisely: how many HUMANS opened a candidate's
 * English Wikipedia article each day. It is not search volume — Google's
 * Trends API remains application-gated — but it is the standard public proxy
 * for name interest: people hear a name, they look it up. The Wikimedia
 * pageviews API is official, free, and unauthenticated; the `user` agent
 * filter matters most, because without it crawler storms register as public
 * interest.
 *
 * Titles are resolved once through Wikipedia's own search and stored on the
 * candidate row; a candidate with no confident match has NO series rather
 * than a guessed one. Data rows are a cache of Wikimedia's numbers, keyed by
 * article so races tracking the same person share a series.
 */
import { sql } from 'drizzle-orm';
import { db } from '@/db';

const API = 'https://wikimedia.org/api/rest_v1/metrics/pageviews/per-article/en.wikipedia/all-access/user';
const WIKI = 'https://en.wikipedia.org/w/api.php';
/** Wikimedia asks API users to identify themselves. */
const USER_AGENT = 'DataDumpster/1.0 (https://www.datadumpster.boston; newsroom analytics)';

export interface AttentionDay {
  day: string;
  views: number;
}

/** 20260818 stamps for the pageviews path. */
export function dayStamp(d: Date): string {
  return d.toISOString().slice(0, 10).replace(/-/g, '');
}

/** Parse one pageviews API response defensively; anything malformed is []. */
export function parsePageviews(payload: unknown): AttentionDay[] {
  const items = (payload as { items?: unknown })?.items;
  if (!Array.isArray(items)) return [];
  const out: AttentionDay[] = [];
  for (const item of items) {
    if (typeof item !== 'object' || item === null) continue;
    const r = item as Record<string, unknown>;
    const stamp = typeof r.timestamp === 'string' ? r.timestamp : '';
    const views = typeof r.views === 'number' && Number.isFinite(r.views) ? r.views : null;
    if (!/^\d{10}$/.test(stamp) || views === null || views < 0) continue;
    out.push({ day: `${stamp.slice(0, 4)}-${stamp.slice(4, 6)}-${stamp.slice(6, 8)}`, views });
  }
  return out;
}

/**
 * Resolve a person's canonical article title, or null.
 *
 * Exact title lookup with redirect following first — "JB Pritzker" redirects
 * to the canonical spelling — then a search fallback whose top hit is only
 * accepted when the title contains the person's surname. A wrong article
 * silently charting is worse than a missing series.
 */
export async function resolveWikipediaTitle(name: string): Promise<string | null> {
  const surname = name.trim().split(/\s+/).pop()?.toLowerCase() ?? '';
  const exact = new URL(WIKI);
  exact.searchParams.set('action', 'query');
  exact.searchParams.set('titles', name);
  exact.searchParams.set('redirects', '1');
  exact.searchParams.set('format', 'json');
  try {
    const res = await fetch(exact, { headers: { 'user-agent': USER_AGENT } });
    if (res.ok) {
      const body = await res.json() as { query?: { pages?: Record<string, { title?: string; missing?: string }> } };
      const page = Object.values(body.query?.pages ?? {})[0];
      if (page?.title && page.missing === undefined) return page.title.replace(/ /g, '_');
    }
  } catch { /* fall through to search */ }

  const search = new URL(WIKI);
  search.searchParams.set('action', 'query');
  search.searchParams.set('list', 'search');
  search.searchParams.set('srsearch', name);
  search.searchParams.set('srlimit', '1');
  search.searchParams.set('format', 'json');
  try {
    const res = await fetch(search, { headers: { 'user-agent': USER_AGENT } });
    if (!res.ok) return null;
    const body = await res.json() as { query?: { search?: { title?: string }[] } };
    const title = body.query?.search?.[0]?.title;
    if (title && surname && title.toLowerCase().includes(surname)) {
      return title.replace(/ /g, '_');
    }
  } catch { /* no confident match */ }
  return null;
}

/** Fetch daily user pageviews for one article over [start, end]. */
export async function fetchAttention(
  title: string,
  start: Date,
  end: Date,
): Promise<AttentionDay[]> {
  const url = `${API}/${encodeURIComponent(title)}/daily/${dayStamp(start)}/${dayStamp(end)}`;
  const res = await fetch(url, { headers: { 'user-agent': USER_AGENT } });
  // 404 means no data for the range (article too new); an empty series is the
  // honest representation, not an error.
  if (res.status === 404) return [];
  if (!res.ok) throw new Error(`pageviews API ${res.status} for ${title}`);
  return parsePageviews(await res.json());
}

/** Upsert a series; re-fetching a window safely overwrites with fresher data. */
export async function storeAttention(title: string, days: AttentionDay[]): Promise<number> {
  if (days.length === 0) return 0;
  const CHUNK = 500;
  let written = 0;
  for (let i = 0; i < days.length; i += CHUNK) {
    const tuples = days.slice(i, i + CHUNK)
      .map((d) => `('${title.replace(/'/g, "''")}', '${d.day}'::date, ${Math.round(d.views)})`)
      .join(',');
    await db.execute(sql.raw(`
      INSERT INTO wikipedia_attention (page_title, day, views)
      VALUES ${tuples}
      ON CONFLICT (page_title, day) DO UPDATE
        SET views = excluded.views, captured_at = now()`));
    written += Math.min(CHUNK, days.length - i);
  }
  return written;
}

/**
 * Refresh recent attention for every mapped candidate.
 *
 * Runs inside the recovery cron once per UTC day: Wikimedia finalizes a day's
 * counts a few hours after it ends, so a two-day lookback keeps yesterday
 * accurate without re-walking history. Free API, ~one request per candidate.
 */
export async function refreshCandidateAttention(): Promise<{ titles: number; rows: number }> {
  const { rows: titles } = await db.execute<{ title: string }>(sql`
    SELECT DISTINCT wikipedia_title AS title
      FROM election_candidates
     WHERE wikipedia_title IS NOT NULL`);
  const end = new Date(Date.now() - 86_400_000);
  const start = new Date(Date.now() - 3 * 86_400_000);
  let rows = 0;
  for (const t of titles) {
    try {
      rows += await storeAttention(t.title, await fetchAttention(t.title, start, end));
    } catch (error) {
      console.error('[data-dumpster:wikipedia-attention] refresh failed', {
        title: t.title,
        error: error instanceof Error ? error.message : 'unknown',
      });
    }
  }
  return { titles: titles.length, rows };
}
