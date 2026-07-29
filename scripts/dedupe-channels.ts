/**
 * Collapse duplicate channels within one company and platform.
 *
 * Same root cause as the company merge: a handle typed during setup
 * ("@bostonglobe") and the canonical id from the Rival IQ export
 * ("UCcNkwfTQuXAxAFwoAUHweJA") describe one account and were stored as two.
 * Both ingest, so the account is counted twice on every leaderboard.
 *
 * The survivor is the export's row, because that identifier was already
 * resolved and polled by the incumbent tool for years. Posts move across;
 * anything the survivor already has is skipped on its own unique key.
 */
import { db } from '@/db';
import { sql } from 'drizzle-orm';

async function main() {
  const groups = await db.execute(sql`
    select company_id, platform::text as platform, count(*) as n
    from channels where active
    group by company_id, platform having count(*) > 1
  `);

  for (const g of groups.rows as Record<string, unknown>[]) {
    const rows = await db.execute(sql`
      select ch.id, ch.handle, ch.meta->>'importedFrom' as imported,
             (select count(*) from posts where channel_id = ch.id) as posts
      from channels ch
      where ch.company_id = ${String(g.company_id)}
        and ch.platform::text = ${String(g.platform)} and ch.active
    `);
    const list = rows.rows as Record<string, unknown>[];

    // Prefer the exported row; fall back to whichever holds more history.
    const sorted = [...list].sort((a, b) => {
      const ai = a.imported === 'rivaliq-export' ? 1 : 0;
      const bi = b.imported === 'rivaliq-export' ? 1 : 0;
      if (ai !== bi) return bi - ai;
      return Number(b.posts) - Number(a.posts);
    });
    const keep = sorted[0];
    const drop = sorted.slice(1);

    for (const d of drop) {
      await db.execute(sql`
        update posts p set channel_id = ${String(keep.id)}
        where p.channel_id = ${String(d.id)}
          and not exists (
            select 1 from posts x
            where x.channel_id = ${String(keep.id)} and x.external_id = p.external_id
          )
      `);
      await db.execute(sql`delete from posts where channel_id = ${String(d.id)}`);
      await db.execute(sql`delete from audience_snapshots where channel_id = ${String(d.id)}`);
      await db.execute(sql`delete from channels where id = ${String(d.id)}`);
      console.log('collapsed ' + g.platform + ' @' + d.handle + ' (' + d.posts
        + ' posts) into @' + keep.handle);
    }
  }

  const still = await db.execute(sql`
    select co.name, ch.platform::text as p, count(*) as n
    from channels ch join companies co on co.id = ch.company_id
    where ch.active group by co.name, ch.platform having count(*) > 1
  `);
  console.log('\nremaining duplicate channels: ' + still.rows.length);
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
