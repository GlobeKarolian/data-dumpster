/**
 * Tagging activity, shared by the API route and the live page's first paint.
 *
 * The live view originally fetched everything client-side and rendered zeros
 * until the first poll — and on some browser sessions the client bundle never
 * ran at all, leaving a page of confident zeros over a database holding
 * thousands. Server-rendering the real numbers makes that failure impossible:
 * polling is enhancement, the truth arrives with the HTML.
 */
import { sql } from 'drizzle-orm';
import { db } from '@/db';

export interface ActivityTag { id: string; name: string; color: string | null; confidence: number | null }
export interface ActivityItem {
  id: string; at: string; company: string; platform: string;
  text: string | null; tags: ActivityTag[];
}
export interface ActivityTotals {
  postsRead: number; tagsApplied: number; spendUsd: number; lastHour: number;
}
export interface TagActivity { totals: ActivityTotals; recent: ActivityItem[] }

export interface ThroughputBucket { hour: string; posts: number }
export interface PlatformCoverage { platform: string; total: number; done: number }
/**
 * Backlog progress. `processed` counts every post the model has read, which is
 * the honest denominator for "how far along are we": a post the model read and
 * found no tag for is finished work, not a gap. `tagged` is the subset that
 * carries at least one tag, and the two are reported separately so neither can
 * be mistaken for the other.
 */
export interface TagProgress {
  totalPosts: number;
  processedPosts: number;
  taggedPosts: number;
  pctProcessed: number;
  throughput: ThroughputBucket[];
  platforms: PlatformCoverage[];
  spendToday: number;
  spend7d: number;
  perPost7d: number | null;
}

export async function getTagProgress(orgId: string): Promise<TagProgress> {
  const head = await db.execute<{
    total: string | number; processed: string | number; tagged: string | number;
    spend_today: string | number; spend_7d: string | number; posts_7d: string | number;
  }>(sql`
    SELECT
      (SELECT count(*) FROM posts p JOIN companies c ON c.id = p.company_id
        WHERE c.org_id = ${orgId}) AS total,
      (SELECT count(*) FROM ai_tag_state WHERE org_id = ${orgId} AND status = 'succeeded') AS processed,
      (SELECT count(DISTINCT a.post_id) FROM post_tag_assignments a
         JOIN post_tags t ON t.id = a.tag_id
        WHERE t.org_id = ${orgId} AND a.source = 'ai') AS tagged,
      (SELECT coalesce(sum(cost_usd), 0) FROM ai_usage
        WHERE org_id = ${orgId} AND feature = 'post-tagging'
          AND created_at >= date_trunc('day', now())) AS spend_today,
      (SELECT coalesce(sum(cost_usd), 0) FROM ai_usage
        WHERE org_id = ${orgId} AND feature = 'post-tagging'
          AND created_at > now() - interval '7 days') AS spend_7d,
      (SELECT count(*) FROM ai_tag_state WHERE org_id = ${orgId}
         AND status = 'succeeded' AND tagged_at > now() - interval '7 days') AS posts_7d`);

  const series = await db.execute<{ hour: string; posts: string | number }>(sql`
    SELECT to_char(date_trunc('hour', tagged_at) AT TIME ZONE 'America/New_York', 'YYYY-MM-DD HH24:MI') AS hour,
           count(*) AS posts
      FROM ai_tag_state
     WHERE org_id = ${orgId} AND status = 'succeeded'
       AND tagged_at > now() - interval '24 hours'
     GROUP BY 1 ORDER BY 1`);

  const plat = await db.execute<{ platform: string; total: string | number; done: string | number }>(sql`
    SELECT p.platform::text AS platform,
           count(*) AS total,
           count(s.post_id) FILTER (WHERE s.status = 'succeeded') AS done
      FROM posts p
      JOIN companies c ON c.id = p.company_id AND c.org_id = ${orgId}
      LEFT JOIN ai_tag_state s ON s.post_id = p.id AND s.org_id = ${orgId}
     GROUP BY p.platform
     ORDER BY count(*) DESC`);

  const h = head.rows[0];
  const total = Number(h?.total ?? 0);
  const processed = Number(h?.processed ?? 0);
  const spend7d = Number(h?.spend_7d ?? 0);
  const posts7d = Number(h?.posts_7d ?? 0);
  return {
    totalPosts: total,
    processedPosts: processed,
    taggedPosts: Number(h?.tagged ?? 0),
    pctProcessed: total > 0 ? (processed / total) * 100 : 0,
    throughput: series.rows.map((r) => ({ hour: r.hour, posts: Number(r.posts) })),
    platforms: plat.rows.map((r) => ({
      platform: r.platform, total: Number(r.total), done: Number(r.done),
    })),
    spendToday: Number(h?.spend_today ?? 0),
    spend7d,
    // Cost per post is only meaningful with a real sample behind it.
    perPost7d: posts7d > 200 ? spend7d / posts7d : null,
  };
}

export async function getTagActivity(orgId: string): Promise<TagActivity> {
  const recent = await db.execute<{
    post_id: string; tagged_at: string; company: string; platform: string;
    text: string | null; tags: unknown;
  }>(sql`
    SELECT s.post_id::text AS post_id, s.tagged_at::text AS tagged_at,
           co.name AS company, p.platform::text AS platform,
           left(coalesce(p.text, ''), 140) AS text,
           coalesce(json_agg(json_build_object(
             'id', t.id, 'name', t.name, 'color', t.color, 'confidence', a.confidence
           ) ORDER BY a.confidence DESC) FILTER (WHERE t.id IS NOT NULL), '[]'::json) AS tags
      FROM ai_tag_state s
      JOIN posts p ON p.id = s.post_id
      JOIN companies co ON co.id = p.company_id
      LEFT JOIN post_tag_assignments a ON a.post_id = s.post_id AND a.source = 'ai'
      LEFT JOIN post_tags t ON t.id = a.tag_id AND t.org_id = ${orgId}
     WHERE s.org_id = ${orgId}
       AND s.status = 'succeeded'
       AND s.tagged_at > now() - interval '2 hours'
     GROUP BY s.post_id, s.tagged_at, co.name, p.platform, p.text
     ORDER BY s.tagged_at DESC
     LIMIT 40`);

  const totals = await db.execute<{
    posts_read: string | number; tags_applied: string | number;
    spend_usd: string | number; last_hour: string | number;
  }>(sql`
    SELECT
      (SELECT count(*) FROM ai_tag_state WHERE org_id = ${orgId} AND status = 'succeeded') AS posts_read,
      (SELECT count(*) FROM post_tag_assignments a JOIN post_tags t ON t.id = a.tag_id
        WHERE t.org_id = ${orgId} AND a.source = 'ai') AS tags_applied,
      (SELECT coalesce(sum(cost_usd), 0) FROM ai_usage
        WHERE org_id = ${orgId} AND feature = 'post-tagging'
          AND created_at >= date_trunc('day', now())) AS spend_usd,
      (SELECT count(*) FROM ai_tag_state WHERE org_id = ${orgId}
        AND status = 'succeeded' AND tagged_at > now() - interval '1 hour') AS last_hour`);

  const t = totals.rows[0];
  return {
    totals: {
      postsRead: Number(t?.posts_read ?? 0),
      tagsApplied: Number(t?.tags_applied ?? 0),
      spendUsd: Number(t?.spend_usd ?? 0),
      lastHour: Number(t?.last_hour ?? 0),
    },
    recent: recent.rows.map((r) => ({
      id: r.post_id,
      at: r.tagged_at,
      company: r.company,
      platform: r.platform,
      text: r.text,
      tags: Array.isArray(r.tags) ? r.tags as ActivityTag[] : [],
    })),
  };
}
