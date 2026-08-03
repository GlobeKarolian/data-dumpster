/**
 * Load a window of posts and cluster them into stories.
 *
 * Kept separate from cluster.ts so the algorithm stays pure and testable with
 * no database in the way, and so the expensive part (one query) is obvious.
 */
import { and, eq, gte, inArray, lte, sql } from 'drizzle-orm';
import { db } from '@/db';
import { posts, companies, postedUrls, landscapeCompanies } from '@/db/schema';
import { clusterPosts, type ClusterablePost, type StoryCluster, type ClusterOptions } from './cluster';
import type { Platform } from '@/lib/types';

export interface StoryQuery {
  landscapeId: string;
  start: Date;
  end: Date;
  platforms?: Platform[];
  companyIds?: string[];
  options?: ClusterOptions;
}

export interface StoryCloud {
  clusters: StoryCluster[];
  /** Posts considered, before clustering. */
  postCount: number;
  /** Posts that landed in no cluster. Reported rather than hidden. */
  unclusteredCount: number;
  range: { start: string; end: string };
}

export async function getStoryCloud(q: StoryQuery): Promise<StoryCloud> {
  const memberIds = db
    .select({ id: landscapeCompanies.companyId })
    .from(landscapeCompanies)
    .where(eq(landscapeCompanies.landscapeId, q.landscapeId));

  const rows = await db
    .select({
      id: posts.id,
      companyId: posts.companyId,
      companyName: companies.name,
      platform: posts.platform,
      postedAt: posts.postedAt,
      text: posts.text,
      permalink: posts.permalink,
      thumbnailUrl: posts.thumbnailUrl,
      engagementTotal: posts.engagementTotal,
      views: posts.views,
      urls: sql<string[]>`coalesce(array_agg(${postedUrls.url}) filter (where ${postedUrls.url} is not null), '{}')`,
    })
    .from(posts)
    .innerJoin(companies, eq(posts.companyId, companies.id))
    .leftJoin(postedUrls, eq(postedUrls.postId, posts.id))
    .where(and(
      /*
       * The company filter INTERSECTS landscape membership; it never replaces it.
       *
       * This read `q.companyIds ?? memberIds`, which made membership a default
       * rather than a bound: any caller who supplied companyIds got exactly
       * those companies, whether or not their org had ever heard of them.
       * Because companies and posts are pooled across orgs by design, a viewer
       * could name another tenant's company id and read its post text,
       * permalinks and engagement through a route that had already, correctly,
       * proven they owned the landscape. Every other scoped query in the
       * product intersects; this one is the reason org-scope.ts exists.
       */
      inArray(posts.companyId, memberIds),
      q.companyIds && q.companyIds.length > 0
        ? inArray(posts.companyId, q.companyIds)
        : undefined,
      gte(posts.postedAt, q.start),
      lte(posts.postedAt, q.end),
      q.platforms && q.platforms.length > 0 ? inArray(posts.platform, q.platforms) : undefined,
    ))
    .groupBy(posts.id, companies.name);

  const items: ClusterablePost[] = rows.map((r) => ({
    ...r,
    text: r.text,
    urls: Array.isArray(r.urls) ? r.urls.filter(Boolean) : [],
  }));

  const clusters = clusterPosts(items, q.options);
  const clustered = new Set(clusters.flatMap((c) => c.postIds));

  return {
    clusters,
    postCount: items.length,
    unclusteredCount: items.length - clustered.size,
    range: { start: q.start.toISOString(), end: q.end.toISOString() },
  };
}
