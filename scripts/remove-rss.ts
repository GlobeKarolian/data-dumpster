/**
 * Remove RSS entirely.
 *
 * RSS was ingested because it needed no credentials and proved the pipeline
 * before any paid source existed. It has outlived that job. A feed carries no
 * engagement and no audience, so its 245 posts entered every average as genuine
 * zeros and dragged engagement-per-post down for the four companies that had
 * feeds and not the eighteen that did not. That is worse than having no data:
 * it is data that makes the comparison wrong.
 *
 * Posts are deleted rather than deactivated. A paused channel keeps its history
 * and its history is the problem here.
 */
import { db } from '@/db';
import { sql } from 'drizzle-orm';

async function main() {
  const before = await db.execute(sql`
    select count(*) as posts,
           (select count(*) from channels where platform = 'rss') as channels
    from posts where platform = 'rss'
  `);
  const b = before.rows[0] as Record<string, unknown>;
  console.log('removing ' + b.posts + ' RSS posts across ' + b.channels + ' channels');

  await db.execute(sql`
    delete from posted_urls where post_id in (select id from posts where platform = 'rss')
  `);
  await db.execute(sql`
    delete from post_tag_assignments where post_id in (select id from posts where platform = 'rss')
  `);
  await db.execute(sql`
    delete from post_metric_snapshots where post_id in (select id from posts where platform = 'rss')
  `);
  await db.execute(sql`
    delete from audience_snapshots where channel_id in (select id from channels where platform = 'rss')
  `);
  await db.execute(sql`delete from posts where platform = 'rss'`);
  await db.execute(sql`delete from ingestion_runs where platform = 'rss'`);
  await db.execute(sql`delete from channels where platform = 'rss'`);

  // Companies that existed only to hold a feed are now empty. Leave the ones
  // that are landscape members; drop the rest.
  const orphans = await db.execute(sql`
    delete from companies c
    where not exists (select 1 from channels where company_id = c.id)
      and not exists (select 1 from posts where company_id = c.id)
      and not exists (select 1 from landscape_companies where company_id = c.id)
    returning name
  `);
  for (const r of orphans.rows as Record<string, unknown>[]) {
    console.log('  removed empty company: ' + r.name);
  }

  const after = await db.execute(sql`
    select platform::text as p, count(*) as n from posts group by 1 order by 2 desc
  `);
  console.log('\nremaining platforms:');
  for (const r of after.rows as Record<string, unknown>[]) {
    console.log('  ' + String(r.p).padEnd(12) + r.n);
  }
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
