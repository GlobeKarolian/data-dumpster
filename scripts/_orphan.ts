import { db } from '@/db';
import { sql } from 'drizzle-orm';
async function main() {
  const r = await db.execute(sql`
    select c.name,
           (lc.company_id is not null) as in_landscape,
           count(p.id) as posts,
           coalesce(sum(p.engagement_total),0) as eng,
           string_agg(distinct p.platform::text, ',') as platforms
    from companies c
    left join (select distinct company_id from landscape_companies) lc on lc.company_id = c.id
    left join posts p on p.company_id = c.id
    group by c.id, c.name, lc.company_id
    having count(p.id) > 0
    order by (lc.company_id is not null), count(p.id) desc
  `);
  console.log('IN?  POSTS      ENG  COMPANY                         PLATFORMS');
  for (const row of r.rows as Record<string, unknown>[]) {
    const inls = row.in_landscape ? ' Y ' : ' N ';
    console.log(inls + String(row.posts).padStart(6) + String(row.eng).padStart(9) + '  '
      + String(row.name).padEnd(30) + String(row.platforms ?? ''));
  }
}
main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
