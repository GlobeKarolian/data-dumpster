import { db } from '@/db';
import { channels, posts } from '@/db/schema';
import { sql, eq } from 'drizzle-orm';

async function main() {
  const rows = await db.select({
    platform: channels.platform,
    total: sql<number>`count(distinct ${channels.id})`,
    active: sql<number>`count(distinct ${channels.id}) filter (where ${channels.active})`,
    ingested: sql<number>`count(distinct ${channels.id}) filter (where ${channels.lastIngestedAt} is not null)`,
  }).from(channels).groupBy(channels.platform);

  const postRows = await db.select({
    platform: posts.platform, n: sql<number>`count(*)`,
  }).from(posts).groupBy(posts.platform);
  const postMap = new Map(postRows.map((r) => [r.platform, Number(r.n)]));

  console.log('PLATFORM     CHANNELS  ACTIVE  EVER RUN     POSTS   WHY NOT');
  console.log('-----------  --------  ------  --------  --------  -------------------------');
  const why: Record<string, string> = {
    facebook: 'needs META_ACCESS_TOKEN (+PPCA for rivals)',
    instagram: 'needs META_ACCESS_TOKEN + IG business id',
    twitter: 'needs TWITTER_BEARER_TOKEN (paid)',
    youtube: 'needs YOUTUBE_API_KEY (free!)',
    threads: 'no adapter written yet',
    linkedin: 'no competitor read path exists',
    tiktok: 'working via Bright Data',
    bluesky: 'working, no key needed',
    rss: 'working, no key needed',
  };
  for (const r of rows.sort((a, b) => (postMap.get(b.platform) ?? 0) - (postMap.get(a.platform) ?? 0))) {
    console.log(
      r.platform.padEnd(13) + String(r.total).padStart(6) + String(r.active).padStart(8)
      + String(r.ingested).padStart(10) + String(postMap.get(r.platform) ?? 0).padStart(10)
      + '  ' + (why[r.platform] ?? ''),
    );
  }
}
main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
