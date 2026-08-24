/**
 * Group View reads. Aggregate by default; identity is a separate, gated fact.
 *
 * The default surfaces answer editorial questions without ever naming a
 * person: what are neighborhoods discussing, whose links travel into them,
 * which groups are actually alive. Those carry no individual's speech.
 *
 * `identitiesVisible` is true only when the viewer is an admin AND the
 * GROUP_IDENTITIES_VISIBLE deployment flag is on. Until then, author names and
 * profile links are never selected, so "we collected identity" and "someone
 * browsed identity" stay distinct, with the second one off by default.
 *
 * Every read here takes an explicit window. Group View used to hardcode 14 and
 * 30 days and ignore the global date picker, which meant the toolbar lied on
 * this screen alone.
 */
import { sql } from 'drizzle-orm';
import { db } from '@/db';
import { roleAtLeast, type Role } from '@/lib/roles';
import type { PostingCadenceCell } from '@/lib/metrics/contract';
import {
  changeRatio, priorWindow, windowIsComparable,
  type GroupCoverage, type GroupWindow,
} from './comparability';

export { windowIsComparable, priorWindow };
export type { GroupCoverage, GroupWindow };

export function groupIdentitiesVisible(role: Role): boolean {
  return roleAtLeast(role, 'admin')
    && process.env.GROUP_IDENTITIES_VISIBLE === 'true';
}

/* ------------------------------------------------------------- coverage */

export async function groupCoverage(orgId: string): Promise<GroupCoverage> {
  const { rows } = await db.execute<{ first_post: string | null; last_post: string | null }>(sql`
    SELECT min(posted_at)::text AS first_post, max(posted_at)::text AS last_post
      FROM group_posts WHERE org_id = ${orgId}`);
  const parse = (v: string | null): Date | null => {
    if (!v) return null;
    const d = new Date(v.includes('T') ? v : v.replace(' ', 'T') + 'Z');
    return Number.isNaN(+d) ? null : d;
  };
  return { firstPost: parse(rows[0]?.first_post ?? null), lastPost: parse(rows[0]?.last_post ?? null) };
}

/* --------------------------------------------------------- run health */

/**
 * Is collection actually running, and what is it costing.
 *
 * On the screen because "it should not stop" is not a thing you can verify by
 * looking at post counts: a stalled collector and a quiet weekend produce the
 * same chart. The last successful round and the trailing 24 hours of vendor
 * spend are the two facts that separate them, and the spend figure is the one
 * that would have caught a $232 round on the day rather than a day later.
 */
export interface GroupRunHealth {
  lastRunAt: Date | null;
  nextRunAt: Date | null;
  activeGroups: number;
  stoppedGroups: number;
  recordsLast24h: number;
  estimatedCentsLast24h: number;
}

export async function groupRunHealth(orgId: string): Promise<GroupRunHealth> {
  const { rows } = await db.execute<{
    last_run: string | null; next_run: string | null;
    active_groups: string | number; stopped_groups: string | number;
    records: string | number; cents: string | number;
  }>(sql`
    SELECT (SELECT max(s.last_collected_at)::text
              FROM group_collection_state s
              JOIN watched_groups g ON g.id = s.group_id
             WHERE g.org_id = ${orgId}) AS last_run,
           (SELECT min(s.next_attempt_at)::text
              FROM group_collection_state s
              JOIN watched_groups g ON g.id = s.group_id
             WHERE g.org_id = ${orgId} AND g.active
               AND s.outcome IS DISTINCT FROM 'ineligible') AS next_run,
           (SELECT count(*) FROM watched_groups WHERE org_id = ${orgId} AND active) AS active_groups,
           (SELECT count(*) FROM group_collection_state s
              JOIN watched_groups g ON g.id = s.group_id
             WHERE g.org_id = ${orgId}
               AND s.outcome IN ('paused', 'ineligible')) AS stopped_groups,
           (SELECT coalesce(sum(records), 0) FROM vendor_spend
             WHERE org_id = ${orgId} AND vendor = 'brightdata'
               AND created_at > now() - interval '24 hours') AS records,
           (SELECT coalesce(sum(estimated_cents), 0) FROM vendor_spend
             WHERE org_id = ${orgId} AND vendor = 'brightdata'
               AND created_at > now() - interval '24 hours') AS cents`);
  const r = rows[0];
  const parse = (v: string | null | undefined): Date | null => {
    if (!v) return null;
    const d = new Date(v.includes('T') ? v : v.replace(' ', 'T') + 'Z');
    return Number.isNaN(+d) ? null : d;
  };
  return {
    lastRunAt: parse(r?.last_run),
    nextRunAt: parse(r?.next_run),
    activeGroups: Number(r?.active_groups ?? 0),
    stoppedGroups: Number(r?.stopped_groups ?? 0),
    recordsLast24h: Number(r?.records ?? 0),
    estimatedCentsLast24h: Number(r?.cents ?? 0),
  };
}

/* ------------------------------------------------------------- headline */

export interface GroupHeadline {
  posts: number;
  engagement: number;
  voices: number;
  activeGroups: number;
  engagementPerPost: number | null;
  /** Fractions, not percents: 0.12 is twelve percent. Null when incomparable. */
  postsChange: number | null;
  engagementChange: number | null;
  engagementPerPostChange: number | null;
}

export async function groupHeadline(
  orgId: string,
  w: GroupWindow,
  coverage: GroupCoverage,
): Promise<GroupHeadline> {
  const prior = priorWindow(w);
  const { rows } = await db.execute<{
    posts: string | number; engagement: string | number; voices: string | number;
    active_groups: string | number; prior_posts: string | number; prior_engagement: string | number;
  }>(sql`
    SELECT
      count(*) FILTER (WHERE gp.posted_at >= ${w.start.toISOString()} AND gp.posted_at < ${w.end.toISOString()}) AS posts,
      coalesce(sum(gp.likes + gp.comments + gp.shares) FILTER (
        WHERE gp.posted_at >= ${w.start.toISOString()} AND gp.posted_at < ${w.end.toISOString()}), 0) AS engagement,
      count(DISTINCT gp.author_name) FILTER (
        WHERE gp.posted_at >= ${w.start.toISOString()} AND gp.posted_at < ${w.end.toISOString()}) AS voices,
      count(DISTINCT gp.group_id) FILTER (
        WHERE gp.posted_at >= ${w.start.toISOString()} AND gp.posted_at < ${w.end.toISOString()}) AS active_groups,
      count(*) FILTER (WHERE gp.posted_at >= ${prior.start.toISOString()} AND gp.posted_at < ${prior.end.toISOString()}) AS prior_posts,
      coalesce(sum(gp.likes + gp.comments + gp.shares) FILTER (
        WHERE gp.posted_at >= ${prior.start.toISOString()} AND gp.posted_at < ${prior.end.toISOString()}), 0) AS prior_engagement
      FROM group_posts gp
     WHERE gp.org_id = ${orgId}`);

  const r = rows[0];
  const posts = Number(r?.posts ?? 0);
  const engagement = Number(r?.engagement ?? 0);
  const comparable = windowIsComparable(w, coverage);
  const priorPosts = Number(r?.prior_posts ?? 0);
  const priorEngagement = Number(r?.prior_engagement ?? 0);
  const perPost = posts > 0 ? engagement / posts : null;
  const priorPerPost = priorPosts > 0 ? priorEngagement / priorPosts : null;
  return {
    posts,
    engagement,
    voices: Number(r?.voices ?? 0),
    activeGroups: Number(r?.active_groups ?? 0),
    engagementPerPost: perPost,
    postsChange: comparable ? changeRatio(posts, priorPosts) : null,
    engagementChange: comparable ? changeRatio(engagement, priorEngagement) : null,
    engagementPerPostChange: comparable && perPost !== null && priorPerPost !== null
      ? changeRatio(perPost, priorPerPost)
      : null,
  };
}

/* --------------------------------------------------------------- trend */

export interface GroupTrendPoint { date: string; posts: number; engagement: number }

export async function groupTrend(orgId: string, w: GroupWindow): Promise<GroupTrendPoint[]> {
  const { rows } = await db.execute<{ day: string; posts: string | number; engagement: string | number }>(sql`
    SELECT to_char(date_trunc('day', gp.posted_at AT TIME ZONE 'America/New_York'), 'YYYY-MM-DD') AS day,
           count(*) AS posts,
           coalesce(sum(gp.likes + gp.comments + gp.shares), 0) AS engagement
      FROM group_posts gp
     WHERE gp.org_id = ${orgId}
       AND gp.posted_at >= ${w.start.toISOString()}
       AND gp.posted_at < ${w.end.toISOString()}
     GROUP BY 1 ORDER BY 1`);
  return rows.map((r) => ({
    date: r.day, posts: Number(r.posts), engagement: Number(r.engagement),
  }));
}

/* -------------------------------------------------------- watched groups */

export interface WatchedGroupRow {
  id: string;
  name: string;
  area: string | null;
  url: string;
  active: boolean;
  posts: number;
  engagement: number;
  voices: number;
  engagementPerPost: number | null;
  lastCollectedAt: string | null;
  outcome: string | null;
}

export async function watchedGroups(orgId: string, w: GroupWindow): Promise<WatchedGroupRow[]> {
  const { rows } = await db.execute<{
    id: string; name: string; area: string | null; url: string; active: boolean;
    posts: string | number; engagement: string | number; voices: string | number;
    last_collected_at: string | null; outcome: string | null;
  }>(sql`
    SELECT g.id::text, g.name, g.area, g.url, g.active,
           coalesce(p.posts, 0) AS posts,
           coalesce(p.engagement, 0) AS engagement,
           coalesce(p.voices, 0) AS voices,
           s.last_collected_at::text AS last_collected_at,
           s.outcome
      FROM watched_groups g
      LEFT JOIN group_collection_state s ON s.group_id = g.id
      LEFT JOIN LATERAL (
        SELECT count(*) AS posts,
               coalesce(sum(gp.likes + gp.comments + gp.shares), 0) AS engagement,
               count(DISTINCT gp.author_name) AS voices
          FROM group_posts gp
         WHERE gp.group_id = g.id
           AND gp.posted_at >= ${w.start.toISOString()}
           AND gp.posted_at < ${w.end.toISOString()}
      ) p ON true
     WHERE g.org_id = ${orgId}
     ORDER BY coalesce(p.posts, 0) DESC, g.name ASC`);
  return rows.map((r) => {
    const posts = Number(r.posts);
    const engagement = Number(r.engagement);
    return {
      id: r.id, name: r.name, area: r.area, url: r.url, active: r.active,
      posts, engagement, voices: Number(r.voices),
      engagementPerPost: posts > 0 ? engagement / posts : null,
      lastCollectedAt: r.last_collected_at,
      outcome: r.outcome,
    };
  });
}

/* --------------------------------------------------------------- topics */

export interface DiscussionRow {
  tagId: string; tagName: string; color: string | null; posts: number; engagement: number;
}

/**
 * What the groups are discussing, by tag. Group posts run the same taxonomy as
 * brand posts through the same model; only the storage differs.
 */
export async function groupDiscussions(
  orgId: string,
  w: GroupWindow,
  limit = 12,
): Promise<DiscussionRow[]> {
  const { rows } = await db.execute<{
    id: string; name: string; color: string | null;
    posts: string | number; engagement: string | number;
  }>(sql`
    SELECT t.id::text AS id, t.name, t.color,
           count(DISTINCT gp.id) AS posts,
           coalesce(sum(gp.likes + gp.comments + gp.shares), 0) AS engagement
      FROM group_posts gp
      JOIN group_post_tag_assignments a ON a.group_post_id = gp.id
      JOIN post_tags t ON t.id = a.tag_id AND t.org_id = ${orgId}
     WHERE gp.org_id = ${orgId}
       AND gp.posted_at >= ${w.start.toISOString()}
       AND gp.posted_at < ${w.end.toISOString()}
     GROUP BY t.id, t.name, t.color
     ORDER BY count(DISTINCT gp.id) DESC
     LIMIT ${limit}`);
  return rows.map((r) => ({
    tagId: r.id, tagName: r.name, color: r.color,
    posts: Number(r.posts), engagement: Number(r.engagement),
  }));
}

/* ---------------------------------------------------------- distribution */

export interface SharedDomainRow { domain: string; shares: number; isOwned: boolean }

/**
 * Domains that are not somebody's published work travelling into a group.
 *
 * Two kinds. Attachment CDNs are the image bytes of the post itself, and they
 * dominated this panel badly enough that the top fifteen was nothing but
 * scontent-ord5-2.xx.fbcdn.net and its siblings. Facebook's own domains are the
 * group's plumbing: a link to another Facebook post, an event, a profile. The
 * question this panel answers is whose journalism reaches these communities, so
 * both are noise rather than answers.
 */
const NOT_A_PUBLISHER_LINK =
  '(^|\\.)(fbcdn\\.net|cdninstagram\\.com|akamaihd\\.net|licdn\\.com|twimg\\.com|ytimg\\.com'
  + '|facebook\\.com|fb\\.me|fb\\.watch|messenger\\.com)$';

/**
 * The org's own web domains, from org settings.
 *
 * This used to be derived from every domain the org's accounts had ever
 * linked to, which marked eventbrite.com and instagram.com as "OURS" because
 * the Globe had once posted links to them. Claiming someone else's domain is
 * ours is exactly the class of confident-but-wrong statement this product must
 * not make, so the list is explicit. An org that has not declared one gets no
 * OURS badges at all, which is the honest default.
 */
export async function ownedDomains(orgId: string): Promise<string[]> {
  const { rows } = await db.execute<{ domains: unknown }>(sql`
    SELECT settings->'ownedDomains' AS domains FROM orgs WHERE id = ${orgId}`);
  const raw = rows[0]?.domains;
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((d): d is string => typeof d === 'string')
    .map((d) => d.trim().toLowerCase().replace(/^www\./, ''))
    .filter(Boolean);
}

/** True when `domain` is one of ours, or a subdomain of one. */
export function isOwnedDomain(domain: string, owned: string[]): boolean {
  const d = domain.toLowerCase().replace(/^www\./, '');
  return owned.some((o) => d === o || d.endsWith('.' + o));
}

export async function sharedDomains(
  orgId: string,
  w: GroupWindow,
  owned: string[],
  limit = 20,
): Promise<SharedDomainRow[]> {
  const { rows } = await db.execute<{ domain: string; shares: string | number }>(sql`
    SELECT lower(u->>'domain') AS domain, count(*) AS shares
      FROM group_posts gp
      -- jsonb_array_elements raises on a non-array, which takes the whole
      -- screen down for one malformed row. The guard keeps a bad row a missing
      -- row rather than an outage.
      CROSS JOIN LATERAL jsonb_array_elements(
        CASE WHEN jsonb_typeof(gp.urls) = 'array' THEN gp.urls ELSE '[]'::jsonb END
      ) AS u
     WHERE gp.org_id = ${orgId}
       AND gp.posted_at >= ${w.start.toISOString()}
       AND gp.posted_at < ${w.end.toISOString()}
       AND coalesce(u->>'domain', '') <> ''
       AND lower(u->>'domain') !~ ${NOT_A_PUBLISHER_LINK}
     GROUP BY lower(u->>'domain')
     ORDER BY count(*) DESC
     LIMIT ${limit}`);
  return rows.map((r) => ({
    domain: r.domain,
    shares: Number(r.shares),
    isOwned: isOwnedDomain(r.domain, owned),
  }));
}

/** Our share of all publisher links landing in these groups. */
export interface LinkShare { ourLinks: number; totalLinks: number; sharePct: number | null }

export async function ourLinkShare(
  orgId: string,
  w: GroupWindow,
  owned: string[],
): Promise<LinkShare> {
  if (owned.length === 0) return { ourLinks: 0, totalLinks: 0, sharePct: null };
  const pattern = '(^|\\.)(' + owned.map((d) => d.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|') + ')$';
  const { rows } = await db.execute<{ ours: string | number; total: string | number }>(sql`
    SELECT
      count(*) FILTER (WHERE lower(u->>'domain') ~ ${pattern}) AS ours,
      count(*) AS total
      FROM group_posts gp
      CROSS JOIN LATERAL jsonb_array_elements(
        CASE WHEN jsonb_typeof(gp.urls) = 'array' THEN gp.urls ELSE '[]'::jsonb END
      ) AS u
     WHERE gp.org_id = ${orgId}
       AND gp.posted_at >= ${w.start.toISOString()}
       AND gp.posted_at < ${w.end.toISOString()}
       AND coalesce(u->>'domain', '') <> ''
       AND lower(u->>'domain') !~ ${NOT_A_PUBLISHER_LINK}`);
  const ours = Number(rows[0]?.ours ?? 0);
  const total = Number(rows[0]?.total ?? 0);
  return { ourLinks: ours, totalLinks: total, sharePct: total > 0 ? (ours / total) * 100 : null };
}

/* ------------------------------------------------------------ top posts */

export interface GroupTopPost {
  id: string;
  groupName: string;
  postedAt: string | null;
  content: string | null;
  likes: number;
  comments: number;
  shares: number;
  engagement: number;
  permalink: string | null;
  /** Only populated when identities are visible to this viewer. */
  authorName: string | null;
  tags: { id: string; name: string; color: string | null }[];
}

export async function groupTopPosts(
  orgId: string,
  w: GroupWindow,
  identitiesVisible: boolean,
  limit = 10,
): Promise<GroupTopPost[]> {
  const { rows } = await db.execute<{
    id: string; group_name: string; posted_at: string | null; content: string | null;
    likes: number; comments: number; shares: number; engagement: string | number;
    permalink: string | null; author_name: string | null; tags: unknown;
  }>(sql`
    SELECT gp.id::text, g.name AS group_name, gp.posted_at::text AS posted_at,
           left(gp.content, 320) AS content,
           gp.likes, gp.comments, gp.shares,
           (gp.likes + gp.comments + gp.shares) AS engagement,
           gp.permalink,
           ${identitiesVisible ? sql`gp.author_name` : sql`NULL::text`} AS author_name,
           coalesce(json_agg(json_build_object('id', t.id, 'name', t.name, 'color', t.color))
             FILTER (WHERE t.id IS NOT NULL), '[]'::json) AS tags
      FROM group_posts gp
      JOIN watched_groups g ON g.id = gp.group_id
      LEFT JOIN group_post_tag_assignments a ON a.group_post_id = gp.id
      LEFT JOIN post_tags t ON t.id = a.tag_id AND t.org_id = ${orgId}
     WHERE gp.org_id = ${orgId}
       AND gp.posted_at >= ${w.start.toISOString()}
       AND gp.posted_at < ${w.end.toISOString()}
       AND coalesce(btrim(gp.content), '') <> ''
     GROUP BY gp.id, g.name, gp.posted_at, gp.content, gp.likes, gp.comments,
              gp.shares, gp.permalink, gp.author_name
     ORDER BY (gp.likes + gp.comments + gp.shares) DESC
     LIMIT ${limit}`);
  return rows.map((r) => ({
    id: r.id,
    groupName: r.group_name,
    postedAt: r.posted_at,
    content: r.content,
    likes: Number(r.likes), comments: Number(r.comments), shares: Number(r.shares),
    engagement: Number(r.engagement),
    permalink: r.permalink,
    authorName: r.author_name,
    tags: Array.isArray(r.tags) ? r.tags as GroupTopPost['tags'] : [],
  }));
}

/* -------------------------------------------------------------- cadence */

/** When these communities actually talk. Same shape the brand cadence uses. */
export async function groupCadence(orgId: string, w: GroupWindow): Promise<PostingCadenceCell[]> {
  const { rows } = await db.execute<{
    weekday: string | number; hour: string | number;
    post_count: string | number; engagement: string | number;
  }>(sql`
    SELECT extract(dow FROM gp.posted_at AT TIME ZONE 'America/New_York')::int AS weekday,
           extract(hour FROM gp.posted_at AT TIME ZONE 'America/New_York')::int AS hour,
           count(*) AS post_count,
           coalesce(sum(gp.likes + gp.comments + gp.shares), 0) AS engagement
      FROM group_posts gp
     WHERE gp.org_id = ${orgId}
       AND gp.posted_at >= ${w.start.toISOString()}
       AND gp.posted_at < ${w.end.toISOString()}
     GROUP BY 1, 2`);
  return rows.map((r) => {
    const postCount = Number(r.post_count);
    return {
      weekday: Number(r.weekday),
      hour: Number(r.hour),
      postCount,
      engagementPerPost: postCount > 0 ? Number(r.engagement) / postCount : 0,
    };
  });
}
