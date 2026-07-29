/**
 * Merge duplicate company rows.
 *
 * WHY THIS IS NEEDED
 * Companies were created twice: once by hand during setup, once by the Rival IQ
 * import, under names that differ only in punctuation ("NBC10 Boston" against
 * "NBC 10 Boston") or in brand convention ("WBUR" against "WBUR News"). The
 * landscape references one row; the other kept the data collected before the
 * import. The Boston Globe, the focus company, had 506 posts on the orphan and
 * 138 on the member, so every Bluesky and RSS post was invisible on every screen.
 *
 * Merging moves channels and posts onto the surviving row and deletes the
 * duplicate. Nothing is thrown away: where both rows hold the same channel, the
 * duplicate's posts are repointed rather than dropped, and a post that already
 * exists on the target is skipped by its own unique key rather than colliding.
 */
import { db } from '@/db';
import { sql } from 'drizzle-orm';

/** [duplicate to remove, survivor to keep]. Survivor is the landscape member. */
const MERGES: [string, string][] = [
  ['The Boston Globe', 'The Boston Globe'],
  ['WBUR', 'WBUR News'],
  ['STAT News', 'statnews.com'],
  ['NBC10 Boston', 'NBC 10 Boston'],
];

async function main() {
  for (const [dupName, keepName] of MERGES) {
    // The survivor is whichever row is actually in a landscape. For the Globe
    // both rows share a name, so membership is the only thing that tells them
    // apart.
    const rows = await db.execute(sql`
      select c.id, c.name, (lc.company_id is not null) as in_landscape,
             (select count(*) from posts where company_id = c.id) as posts
      from companies c
      left join (select distinct company_id from landscape_companies) lc on lc.company_id = c.id
      where c.name = ${dupName} or c.name = ${keepName}
    `);
    const all = rows.rows as Record<string, unknown>[];
    const keep = all.find((r) => r.in_landscape);
    const dups = all.filter((r) => !r.in_landscape);
    if (!keep || dups.length === 0) {
      console.log('skip ' + dupName + ' -> ' + keepName + ' (nothing to merge)');
      continue;
    }

    for (const dup of dups) {
      const dupId = String(dup.id);
      const keepId = String(keep.id);
      if (dupId === keepId) continue;

      // Channels the survivor already has, by platform+handle. The duplicate's
      // version of those is redundant, so its posts move to the survivor's
      // channel and the duplicate channel goes.
      await db.execute(sql`
        update posts p set channel_id = k.id, company_id = ${keepId}
        from channels d
        join channels k on k.company_id = ${keepId}
                       and k.platform = d.platform
                       and k.handle = d.handle
        where d.company_id = ${dupId} and p.channel_id = d.id
          and not exists (
            select 1 from posts x where x.channel_id = k.id and x.external_id = p.external_id
          )
      `);

      // Anything left on a duplicated channel is a true collision: the survivor
      // already has that post. Drop the duplicate rows rather than the channel's
      // whole history.
      await db.execute(sql`
        delete from posts p using channels d
        join channels k on k.company_id = ${keepId}
                       and k.platform = d.platform
                       and k.handle = d.handle
        where d.company_id = ${dupId} and p.channel_id = d.id
      `);
      await db.execute(sql`
        delete from channels d using channels k
        where d.company_id = ${dupId} and k.company_id = ${keepId}
          and k.platform = d.platform and k.handle = d.handle
      `);

      // Remaining channels are unique to the duplicate. Move them wholesale;
      // their audience snapshots follow the channel id and need no work.
      await db.execute(sql`update channels set company_id = ${keepId} where company_id = ${dupId}`);
      await db.execute(sql`update posts set company_id = ${keepId} where company_id = ${dupId}`);
      await db.execute(sql`update posted_urls set company_id = ${keepId} where company_id = ${dupId}`);
      await db.execute(sql`delete from companies where id = ${dupId}`);

      console.log('merged "' + dup.name + '" (' + dup.posts + ' posts) into "' + keep.name + '"');
    }
  }

  const left = await db.execute(sql`
    select c.name, count(p.id) as posts from companies c
    left join (select distinct company_id from landscape_companies) lc on lc.company_id = c.id
    left join posts p on p.company_id = c.id
    where lc.company_id is null group by c.id, c.name having count(p.id) > 0 order by 2 desc
  `);
  console.log('\nStill outside every landscape:');
  for (const r of left.rows as Record<string, unknown>[]) {
    console.log('  ' + String(r.name).padEnd(28) + String(r.posts) + ' posts');
  }
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
