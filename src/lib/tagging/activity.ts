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
