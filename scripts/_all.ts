import { db } from '@/db';
import { sql } from 'drizzle-orm';

async function main() {
  const r = await db.execute(sql`
    select platform::text as p, count(*) as posts,
           coalesce(sum(views),0) as views, coalesce(sum(engagement_total),0) as eng,
           count(distinct company_id) as companies
    from posts group by platform order by count(*) desc
  `);
  console.log('PLATFORM     POSTS  COMPANIES         VIEWS      ENGAGEMENT');
  let tp = 0; let tv = 0; let te = 0;
  for (const row of r.rows as Record<string, unknown>[]) {
    tp += Number(row.posts); tv += Number(row.views); te += Number(row.eng);
    console.log(
      String(row.p).padEnd(12) + String(row.posts).padStart(6)
      + String(row.companies).padStart(11) + Number(row.views).toLocaleString().padStart(14)
      + Number(row.eng).toLocaleString().padStart(16),
    );
  }
  console.log('-'.repeat(59));
  console.log('TOTAL'.padEnd(12) + String(tp).padStart(6) + ''.padStart(11)
    + tv.toLocaleString().padStart(14) + te.toLocaleString().padStart(16));
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
