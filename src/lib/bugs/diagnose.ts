import 'server-only';
import { sql } from 'drizzle-orm';
import { db } from '@/db';
import { PLATFORM_LABELS } from '@/lib/types';
import { postUrlsIn, type ParsedPostUrl } from './parse';
import { postVerdict, type PostVerdict, type TrackedChannelFacts } from './verdict';

/**
 * Facts about a bug report, computed in code before any model sees it.
 *
 * The question behind most reports is "is this post in Data Dumpster, and if
 * not, why not". That is a database question, so it is answered here and the
 * answer is stored on the report. The model only phrases and routes; it never
 * computes, and anything it says about numbers is checked against this sheet.
 */

export interface StoredCopy {
  postId: string;
  company: string;
  handle: string;
  postedAt: string;
}

export interface PostFinding {
  url: string;
  platform: ParsedPostUrl['platform'];
  platformLabel: string;
  handle: string | null;
  /** Where the handle came from: the link itself, or the public post page. */
  handleSource: 'url' | 'page' | null;
  postKey: string;
  /** Publish date read from the public post page, when it exposes one. */
  postedOn: string | null;
  stored: StoredCopy[];
  channels: TrackedChannelFacts[];
  verdict: PostVerdict;
  verdictText: string;
}

export interface BugDiagnostics {
  generatedAt: string;
  posts: PostFinding[];
  health: { activeChannels: number; overdueChannels: number } | null;
}

const UA = 'facebookexternalhit/1.1';

/**
 * Instagram /p/ links carry no handle. The public page's Open Graph tags name
 * the owner and the publish date, so read those. Best effort: a block, a
 * timeout or a changed page simply leaves the handle unknown.
 */
async function instagramPageFacts(url: string): Promise<{ handle: string | null; postedOn: string | null }> {
  try {
    const res = await fetch(url, {
      headers: { 'user-agent': UA },
      signal: AbortSignal.timeout(6000),
      redirect: 'follow',
    });
    if (!res.ok) return { handle: null, postedOn: null };
    const html = (await res.text()).slice(0, 400_000);
    const ogUrl = html.match(/property="og:url" content="https:\/\/www\.instagram\.com\/([A-Za-z0-9._]+)\/(?:p|reel|tv)\//);
    const date = html.match(/ on ([A-Z][a-z]+ \d{1,2}, \d{4})/);
    let postedOn: string | null = null;
    if (date) {
      const d = new Date(date[1] + ' 12:00:00 UTC');
      if (!Number.isNaN(d.getTime())) postedOn = d.toISOString().slice(0, 10);
    }
    return { handle: ogUrl ? ogUrl[1].toLowerCase() : null, postedOn };
  } catch {
    return { handle: null, postedOn: null };
  }
}

type StoredRow = { post_id: string; company: string; handle: string; posted_at: string | Date } & Record<string, unknown>;
type ChannelRow = {
  channel_id: string;
  company: string;
  handle: string;
  active: boolean;
  status: string | null;
  outcome: string | null;
  attempted_until: string | Date | null;
  last_error: string | null;
  newest_post: string | Date | null;
  posts_14d: string | number;
  source_errors: string | null;
} & Record<string, unknown>;

const iso = (v: string | Date | null): string | null =>
  v === null ? null : (v instanceof Date ? v : new Date(v)).toISOString();

async function storedCopies(p: ParsedPostUrl): Promise<StoredCopy[]> {
  const { rows } = await db.execute<StoredRow>(sql`
    SELECT p.id AS post_id, co.name AS company, ch.handle, p.posted_at
      FROM posts p
      JOIN channels ch ON ch.id = p.channel_id
      JOIN companies co ON co.id = p.company_id
     WHERE p.platform = ${p.platform}
       AND (p.external_id = ${p.postKey}
            OR strpos(coalesce(p.permalink, ''), '/' || ${p.postKey}) > 0)
     LIMIT 10
  `);
  return rows.map((r) => ({ postId: r.post_id, company: r.company, handle: r.handle, postedAt: iso(r.posted_at)! }));
}

async function trackedChannels(p: ParsedPostUrl, handle: string): Promise<TrackedChannelFacts[]> {
  const { rows } = await db.execute<ChannelRow>(sql`
    SELECT ch.id AS channel_id, co.name AS company, ch.handle, ch.active,
           s.status::text AS status, s.outcome::text AS outcome,
           coalesce(s.attempted_until, s.coverage_until) AS attempted_until,
           s.last_error,
           (SELECT max(x.posted_at) FROM posts x WHERE x.channel_id = ch.id) AS newest_post,
           (SELECT count(*) FROM posts x WHERE x.channel_id = ch.id
              AND x.posted_at > now() - interval '14 days') AS posts_14d,
           (SELECT string_agg(left(ps.last_error, 300), ' | ')
              FROM public_channel_source_state ps
             WHERE ps.channel_id = ch.id AND ps.last_error IS NOT NULL) AS source_errors
      FROM channels ch
      JOIN companies co ON co.id = ch.company_id
      LEFT JOIN channel_collection_state s ON s.channel_id = ch.id
     WHERE ch.platform = ${p.platform}
       AND lower(ch.handle) = ${handle}
     LIMIT 5
  `);
  return rows.map((r) => ({
    channelId: r.channel_id,
    company: r.company,
    handle: r.handle,
    active: r.active,
    status: r.status,
    outcome: r.outcome,
    lastAttemptAt: iso(r.attempted_until),
    lastError: r.last_error ?? r.source_errors ?? null,
    newestPostAt: iso(r.newest_post),
    postsLast14Days: Number(r.posts_14d),
  }));
}

async function healthCounts(): Promise<BugDiagnostics['health']> {
  try {
    const { rows } = await db.execute<{ overdue: number; total: number }>(sql`
      SELECT count(*) FILTER (
               WHERE coalesce(state.attempted_until, state.coverage_until) IS NULL
                  OR coalesce(state.attempted_until, state.coverage_until) < now() - interval '24 hours'
             )::int AS overdue,
             count(*)::int AS total
        FROM channels c
        LEFT JOIN channel_collection_state state ON state.channel_id = c.id
       WHERE c.active
         AND EXISTS (SELECT 1 FROM landscape_channel_demands d WHERE d.channel_id = c.id)
    `);
    return { activeChannels: rows[0]?.total ?? 0, overdueChannels: rows[0]?.overdue ?? 0 };
  } catch {
    return null;
  }
}

export async function diagnoseReport(text: string, now = new Date()): Promise<BugDiagnostics> {
  const links = postUrlsIn(text);
  const posts: PostFinding[] = [];

  for (const link of links) {
    let handle = link.handle;
    let handleSource: PostFinding['handleSource'] = handle ? 'url' : null;
    let postedOn: string | null = null;
    if (link.platform === 'instagram') {
      const page = await instagramPageFacts(link.url);
      postedOn = page.postedOn;
      if (!handle && page.handle) {
        handle = page.handle;
        handleSource = 'page';
      }
    }

    const stored = await storedCopies(link);
    const channels = handle ? await trackedChannels(link, handle) : [];
    const { verdict, text: verdictText } = postVerdict({
      platformLabel: PLATFORM_LABELS[link.platform],
      handle,
      postedOn,
      stored,
      channels,
      now,
    });

    posts.push({
      url: link.url,
      platform: link.platform,
      platformLabel: PLATFORM_LABELS[link.platform],
      handle,
      handleSource,
      postKey: link.postKey,
      postedOn,
      stored,
      channels,
      verdict,
      verdictText,
    });
  }

  return { generatedAt: now.toISOString(), posts, health: await healthCounts() };
}
