/**
 * Group View reads. Aggregate by default; identity is a separate, gated fact.
 *
 * The default surfaces answer two questions without ever naming a person: what
 * are neighborhoods discussing, and whose links travel into them. Those are the
 * editorially useful outputs and they carry no individual's speech.
 *
 * `identitiesVisible` is true only when the viewer is an admin AND the
 * GROUP_IDENTITIES_VISIBLE deployment flag is on. Until then, author names and
 * profile links are never selected, so "we collected identity" and "someone
 * browsed identity" stay distinct, with the second one off by default.
 */
import { sql } from 'drizzle-orm';
import { db } from '@/db';
import { roleAtLeast, type Role } from '@/lib/roles';

export function groupIdentitiesVisible(role: Role): boolean {
  return roleAtLeast(role, 'admin')
    && process.env.GROUP_IDENTITIES_VISIBLE === 'true';
}

export interface WatchedGroupRow {
  id: string;
  name: string;
  area: string | null;
  url: string;
  active: boolean;
  posts30d: number;
  lastCollectedAt: string | null;
  outcome: string | null;
}

export async function watchedGroups(orgId: string): Promise<WatchedGroupRow[]> {
  const { rows } = await db.execute<{
    id: string; name: string; area: string | null; url: string; active: boolean;
    posts_30d: string | number; last_collected_at: string | null; outcome: string | null;
  }>(sql`
    SELECT g.id::text, g.name, g.area, g.url, g.active,
           coalesce(p.n, 0) AS posts_30d,
           s.last_collected_at::text AS last_collected_at,
           s.outcome
      FROM watched_groups g
      LEFT JOIN group_collection_state s ON s.group_id = g.id
      LEFT JOIN LATERAL (
        SELECT count(*) AS n FROM group_posts gp
         WHERE gp.group_id = g.id AND gp.posted_at > now() - interval '30 days'
      ) p ON true
     WHERE g.org_id = ${orgId}
     ORDER BY g.active DESC, g.name ASC`);
  return rows.map((r) => ({
    id: r.id, name: r.name, area: r.area, url: r.url, active: r.active,
    posts30d: Number(r.posts_30d),
    lastCollectedAt: r.last_collected_at,
    outcome: r.outcome,
  }));
}

export interface DiscussionRow { tagName: string; color: string | null; posts: number }

/**
 * What the groups are discussing, by tag. Uses the same tagging pipeline as
 * brand posts once group posts are tagged; until then this returns what exists.
 */
export async function groupDiscussions(orgId: string, days: number): Promise<DiscussionRow[]> {
  const { rows } = await db.execute<{ name: string; color: string | null; posts: string | number }>(sql`
    SELECT t.name, t.color, count(DISTINCT gp.id) AS posts
      FROM group_posts gp
      JOIN group_post_tag_assignments a ON a.group_post_id = gp.id
      JOIN post_tags t ON t.id = a.tag_id AND t.org_id = ${orgId}
     WHERE gp.org_id = ${orgId}
       AND gp.posted_at > now() - make_interval(days => ${days})
     GROUP BY t.name, t.color
     ORDER BY count(DISTINCT gp.id) DESC
     LIMIT 20`);
  return rows.map((r) => ({ tagName: r.name, color: r.color, posts: Number(r.posts) }));
}

export interface SharedDomainRow { domain: string; shares: number; isOwned: boolean }

/**
 * The org's own web domains, from org settings.
 *
 * This used to be derived from every domain the org's accounts had ever
 * linked to, which is a different thing entirely: it marked eventbrite.com,
 * instagram.com and docs.google.com as "OURS" because the Globe had once
 * posted links to them. Claiming someone else's domain is ours is exactly the
 * class of confident-but-wrong statement this product must not make, so the
 * list is now explicit. An org that has not set one gets no OURS badges at
 * all, which is the honest default.
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

/**
 * Whose links travel into local groups — the distribution intelligence nobody
 * else has. Aggregate by domain; no post text, no author.
 */
export async function sharedDomains(orgId: string, days: number, ownedDomains: string[]): Promise<SharedDomainRow[]> {
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
       AND gp.posted_at > now() - make_interval(days => ${days})
       AND coalesce(u->>'domain', '') <> ''
       -- Attachment CDNs are media, not shared links.
       AND lower(u->>'domain') !~ '(^|\.)(fbcdn\.net|cdninstagram\.com|akamaihd\.net|licdn\.com|twimg\.com|ytimg\.com)$'
     GROUP BY lower(u->>'domain')
     ORDER BY count(*) DESC
     LIMIT 40`);
  return rows.map((r) => ({
    domain: r.domain,
    shares: Number(r.shares),
    isOwned: isOwnedDomain(r.domain, ownedDomains),
  }));
}
