import { db } from '@/db';
import { sql } from 'drizzle-orm';
async function main() {
  const r = await db.execute(sql`
    select platform::text as p, count(*) as n,
           count(*) filter (where thumbnail_url is not null) as thumbs,
           count(*) filter (where permalink is not null) as links,
           count(*) filter (where text is not null and text <> '') as texts
    from posts group by 1 order by 2 desc
  `);
  console.log('PLATFORM     POSTS  THUMBS   LINKS   TEXT');
  for (const row of r.rows as Record<string, unknown>[]) {
    console.log(String(row.p).padEnd(12) + String(row.n).padStart(6)
      + String(row.thumbs).padStart(8) + String(row.links).padStart(8) + String(row.texts).padStart(7));
  }
  const s = await db.execute(sql`
    select platform::text as p, thumbnail_url from posts
    where thumbnail_url is not null order by random() limit 4
  `);
  console.log('\nsamples:');
  for (const row of s.rows as Record<string, unknown>[]) {
    console.log('  ' + String(row.p).padEnd(11) + String(row.thumbnail_url).slice(0, 92));
  }
}
main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
