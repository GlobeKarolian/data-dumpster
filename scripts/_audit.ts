import { db } from '@/db';
import { sql } from 'drizzle-orm';

async function q(label: string, query: ReturnType<typeof sql>) {
  const r = await db.execute(query);
  console.log('\n### ' + label);
  if (r.rows.length === 0) { console.log('  (clean)'); return; }
  for (const row of r.rows as Record<string, unknown>[]) {
    console.log('  ' + Object.entries(row).map(([k, v]) => k + '=' + String(v ?? '')).join('  '));
  }
}

async function main() {
  await q('Duplicate companies (same brand, two rows)', sql`
    select lower(regexp_replace(name,'[^a-zA-Z0-9]','','g')) as norm,
           count(*) as n, string_agg(name, ' | ') as names
    from companies group by 1 having count(*) > 1 order by 2 desc`);

  await q('Companies in NO landscape', sql`
    select c.name from companies c
    left join landscape_companies lc on lc.company_id = c.id
    where lc.company_id is null order by c.name`);

  await q('Duplicate channels (same company+platform, different handle)', sql`
    select co.name, ch.platform::text as platform, count(*) as n,
           string_agg(ch.handle, ' | ') as handles
    from channels ch join companies co on co.id = ch.company_id
    where ch.active group by co.name, ch.platform having count(*) > 1 order by 3 desc limit 15`);

  await q('Active channels that have NEVER ingested', sql`
    select ch.platform::text as platform, count(*) as n
    from channels ch where ch.active and ch.last_ingested_at is null
    group by 1 order by 2 desc`);

  await q('Audience coverage (days with a follower reading)', sql`
    select platform::text as platform, count(distinct day) as days,
           min(day) as first, max(day) as last
    from audience_snapshots a join channels c on c.id = a.channel_id
    group by 1 order by 2 desc`);

  await q('Posts with zero engagement AND zero views (dead rows)', sql`
    select platform::text as platform, count(*) as n
    from posts where engagement_total = 0 and views = 0
    group by 1 order by 2 desc`);

  await q('Posts missing followers_at_post (breaks eng rate by follower)', sql`
    select platform::text as platform, count(*) as n
    from posts where followers_at_post is null group by 1 order by 2 desc`);

  await q('Landscapes', sql`
    select l.name, l.slug, count(lc.company_id) as members,
           (select name from companies where id = l.focus_company_id) as focus
    from landscapes l left join landscape_companies lc on lc.landscape_id = l.id
    group by l.id, l.name, l.slug, l.focus_company_id order by l.name`);
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
