import { db } from '@/db';
import { posts, companies, postedUrls } from '@/db/schema';
import { eq, gte, sql } from 'drizzle-orm';
import { clusterPosts, type ClusterablePost } from '@/lib/stories/cluster';

async function main() {
  const since = new Date(Date.now() - 35 * 864e5);
  const rows = await db.select({
    id: posts.id, companyId: posts.companyId, companyName: companies.name,
    platform: posts.platform, postedAt: posts.postedAt, text: posts.text,
    permalink: posts.permalink, thumbnailUrl: posts.thumbnailUrl,
    engagementTotal: posts.engagementTotal, views: posts.views,
    urls: sql<string[]>`coalesce(array_agg(${postedUrls.url}) filter (where ${postedUrls.url} is not null), '{}')`,
  }).from(posts).innerJoin(companies, eq(posts.companyId, companies.id))
    .leftJoin(postedUrls, eq(postedUrls.postId, posts.id))
    .where(gte(posts.postedAt, since)).groupBy(posts.id, companies.name);

  const items: ClusterablePost[] = rows.map((r) => ({ ...r, urls: r.urls ?? [] }));
  console.log('posts: ' + items.length + '\n');

  const configs = [
    { name: 'tight (current)', threshold: 0.34, halfLifeHours: 36, maxGapHours: 168 },
    { name: 'event-scale', threshold: 0.30, halfLifeHours: 240, maxGapHours: 720 },
    { name: 'topic-scale', threshold: 0.26, halfLifeHours: 480, maxGapHours: 840 },
    { name: 'loose', threshold: 0.22, halfLifeHours: 720, maxGapHours: 840 },
  ];

  for (const cfg of configs) {
    const cs = clusterPosts(items, cfg);
    const multi = cs.filter((c) => c.companies.length > 1);
    const biggest = cs.reduce((a, b) => (b.posts.length > (a?.posts.length ?? 0) ? b : a), cs[0]);
    const spanDays = cs.length
      ? (cs.reduce((s, c) => s + (c.lastPostedAt.getTime() - c.firstPostedAt.getTime()), 0) / cs.length) / 864e5
      : 0;
    console.log(cfg.name.padEnd(16)
      + ' clusters=' + String(cs.length).padStart(4)
      + ' multiOutlet=' + String(multi.length).padStart(3)
      + ' biggest=' + String(biggest?.posts.length ?? 0).padStart(3)
      + ' avgSpanDays=' + spanDays.toFixed(1)
      + ' avgCohesion=' + (cs.reduce((s, c) => s + c.cohesion, 0) / (cs.length || 1)).toFixed(2));
  }

  console.log('\n--- event-scale, biggest multi-outlet clusters ---\n');
  const cs = clusterPosts(items, { threshold: 0.30, halfLifeHours: 240, maxGapHours: 720 });
  for (const c of cs.filter((x) => x.companies.length > 1).slice(0, 8)) {
    const days = ((c.lastPostedAt.getTime() - c.firstPostedAt.getTime()) / 864e5).toFixed(1);
    console.log('* ' + c.posts.length + ' posts, ' + c.companies.length + ' outlets, spans ' + days + 'd, coh '
      + c.cohesion.toFixed(2));
    console.log('  ' + c.companies.map((x) => x.name).join(', ').slice(0, 80));
    console.log('  terms: ' + c.keywords.join(' '));
    console.log('  "' + c.label.slice(0, 88) + '"\n');
  }
}
main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
