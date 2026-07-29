import { db } from '@/db';
import { posts, companies, postedUrls } from '@/db/schema';
import { eq, gte, sql } from 'drizzle-orm';
import { clusterPosts, type ClusterablePost } from '@/lib/stories/cluster';

async function main() {
  const since = new Date(Date.now() - 21 * 864e5);
  const rows = await db
    .select({
      id: posts.id, companyId: posts.companyId, companyName: companies.name,
      platform: posts.platform, postedAt: posts.postedAt, text: posts.text,
      permalink: posts.permalink, thumbnailUrl: posts.thumbnailUrl,
      engagementTotal: posts.engagementTotal, views: posts.views,
      urls: sql<string[]>`coalesce(array_agg(${postedUrls.url}) filter (where ${postedUrls.url} is not null), '{}')`,
    })
    .from(posts)
    .innerJoin(companies, eq(posts.companyId, companies.id))
    .leftJoin(postedUrls, eq(postedUrls.postId, posts.id))
    .where(gte(posts.postedAt, since))
    .groupBy(posts.id, companies.name);

  const items: ClusterablePost[] = rows.map((r) => ({ ...r, urls: r.urls ?? [] }));
  console.log('posts in window: ' + items.length);

  const t0 = Date.now();
  const clusters = clusterPosts(items);
  console.log('clusters: ' + clusters.length + ' in ' + (Date.now() - t0) + 'ms\n');

  for (const c of clusters.slice(0, 12)) {
    console.log('* ' + c.posts.length + ' posts | ' + c.companies.length + ' outlets | eng '
      + c.totalEngagement.toLocaleString() + ' | cohesion ' + c.cohesion.toFixed(2));
    console.log('  broke: ' + (c.brokeBy?.name ?? '?') + ' | outlets: '
      + c.companies.map((x) => x.name).join(', ').slice(0, 90));
    console.log('  terms: ' + c.keywords.join(' '));
    console.log('  "' + c.label.slice(0, 96) + '"\n');
  }
}
main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
