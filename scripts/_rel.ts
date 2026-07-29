import { db } from '@/db';
import { sql } from 'drizzle-orm';

async function main() {
  const r = await db.execute(sql`
    select platform::text as platform,
           count(*) as runs,
           count(*) filter (where status::text = 'succeeded') as ok,
           count(*) filter (where status::text = 'failed') as failed,
           coalesce(sum(posts_upserted),0) as posts,
           round(percentile_disc(0.5) within group (order by extract(epoch from (finished_at - started_at)))) as p50,
           round(percentile_disc(0.95) within group (order by extract(epoch from (finished_at - started_at)))) as p95
    from ingestion_runs group by platform order by count(*) desc
  `);
  console.log('PLATFORM    RUNS   OK  FAIL  SUCCESS%   p50s   p95s   POSTS');
  for (const row of r.rows as Record<string, unknown>[]) {
    const ok = Number(row.ok); const failed = Number(row.failed);
    const att = ok + failed;
    const pct = att ? ((ok / att) * 100).toFixed(0) + '%' : '--';
    console.log(
      String(row.platform).padEnd(10) + String(row.runs).padStart(6) + String(ok).padStart(5)
      + String(failed).padStart(6) + pct.padStart(10)
      + String(row.p50 ?? '--').padStart(7) + String(row.p95 ?? '--').padStart(7)
      + String(row.posts).padStart(8),
    );
  }
  const e = await db.execute(sql`
    select error, count(*) as n from ingestion_runs
    where error is not null group by error order by count(*) desc limit 6
  `);
  console.log('\nTOP FAILURES');
  for (const row of e.rows as Record<string, unknown>[]) {
    console.log('  ' + String(row.n).padStart(3) + 'x  ' + String(row.error).slice(0, 95));
  }
}
main().then(() => process.exit(0)).catch((err) => { console.error(err); process.exit(1); });
