/**
 * Tag the group-post backlog.
 *
 * Same shape and same safety posture as scripts/backfill-tags.ts: it calls the
 * production `runGroupTaggingTick`, and the ceiling is measured against
 * ai_usage in the database rather than an in-memory total, so a wedged or
 * duplicated worker cannot spend past it.
 *
 * Scope defaults to a recent window rather than the whole archive, because the
 * Group View surfaces answer "what is being discussed now" and the archive
 * reaches back to 2018. Set BACKFILL_GROUP_DAYS=0 to include everything.
 *
 *   npx tsx scripts/backfill-group-tags.ts
 */
import { sql } from 'drizzle-orm';
import { db } from '../src/db';
import { orgsWithAiTags } from '../src/lib/tagging/queue';
import { runGroupTaggingTick } from '../src/lib/tagging/group-queue';

const MAX_USD = Number(process.env.BACKFILL_MAX_USD ?? 40);
const WORKERS = Number(process.env.BACKFILL_WORKERS ?? 8);
const DAYS = Number(process.env.BACKFILL_GROUP_DAYS ?? 400);
const IDLE_LIMIT = 3;

const startedAt = new Date();

async function spentSinceStartUsd(): Promise<number> {
  const { rows } = await db.execute<{ usd: string | number | null }>(sql`
    SELECT coalesce(sum(cost_usd), 0) AS usd FROM ai_usage
     WHERE feature = 'post-tagging' AND created_at >= ${startedAt.toISOString()}`);
  return Number(rows[0]?.usd ?? 0);
}

async function remaining(): Promise<number> {
  const { rows } = await db.execute<{ n: string | number }>(sql`
    SELECT count(*) AS n FROM group_posts gp
      LEFT JOIN group_tag_state s ON s.group_post_id = gp.id
     WHERE s.group_post_id IS NULL
       AND coalesce(btrim(gp.content), '') <> ''`);
  return Number(rows[0]?.n ?? 0);
}

let aborted = false;
let idleStreak = 0;
const totals = { tagged: 0, assignments: 0, failed: 0 };

async function worker(orgIds: string[], id: number): Promise<void> {
  while (!aborted) {
    let claimed = 0;
    for (const orgId of orgIds) {
      if (aborted) return;
      try {
        const r = await runGroupTaggingTick(orgId);
        totals.tagged += r.tagged;
        totals.assignments += r.assignmentsWritten;
        totals.failed += r.failed;
        claimed += r.claimed;
      } catch (err) {
        console.error(`  worker ${id}:`, err instanceof Error ? err.message : err);
      }
    }
    if (claimed === 0) {
      idleStreak += 1;
      if (idleStreak >= IDLE_LIMIT) return;
      await new Promise((r) => setTimeout(r, 1500));
    } else idleStreak = 0;
  }
}

async function guard(): Promise<void> {
  while (!aborted) {
    await new Promise((r) => setTimeout(r, 10_000));
    const spent = await spentSinceStartUsd();
    const left = await remaining();
    console.log(`  spent $${spent.toFixed(2)} / $${MAX_USD} · untagged group posts ${left.toLocaleString()}`
      + ` · tagged ${totals.tagged.toLocaleString()} · assignments ${totals.assignments.toLocaleString()}`);
    if (spent >= MAX_USD) {
      aborted = true;
      console.log(`\nCEILING REACHED at $${spent.toFixed(2)}. Stopping.`);
      return;
    }
    if (idleStreak >= IDLE_LIMIT) return;
  }
}

async function main(): Promise<void> {
  process.env.AI_TAGGING_DAILY_USD = String(MAX_USD * 10);

  if (DAYS > 0) {
    // Park anything older than the window as out of scope, so the claim query
    // never reaches it and the run cannot silently buy the whole archive.
    const { rowCount } = await db.execute(sql`
      INSERT INTO group_tag_state (org_id, group_post_id, taxonomy_fingerprint, status, next_attempt_at, updated_at)
      SELECT gp.org_id, gp.id, 'out-of-scope', 'succeeded', NULL, now()
        FROM group_posts gp
        LEFT JOIN group_tag_state s ON s.group_post_id = gp.id
       WHERE s.group_post_id IS NULL
         AND (gp.posted_at IS NULL OR gp.posted_at < now() - make_interval(days => ${DAYS}))
      ON CONFLICT DO NOTHING`);
    console.log(`Scoped to last ${DAYS} days; parked ${rowCount ?? 0} older posts as out of scope.`);
  }

  const orgIds = await orgsWithAiTags();
  const before = await remaining();
  console.log(`Group tagging backfill: ${before.toLocaleString()} posts in scope`);
  console.log(`Workers ${WORKERS} · ceiling $${MAX_USD}\n`);
  if (orgIds.length === 0 || before === 0) { console.log('Nothing to do.'); return; }

  const g = guard();
  await Promise.all(Array.from({ length: WORKERS }, (_, i) => worker(orgIds, i + 1)));
  aborted = true;
  await g;

  const spent = await spentSinceStartUsd();
  console.log('\n=== GROUP TAGGING COMPLETE ===');
  console.log(`  tagged      : ${totals.tagged.toLocaleString()}`);
  console.log(`  assignments : ${totals.assignments.toLocaleString()}`);
  console.log(`  failed      : ${totals.failed.toLocaleString()}`);
  console.log(`  remaining   : ${(await remaining()).toLocaleString()}`);
  console.log(`  spent       : $${spent.toFixed(2)} of $${MAX_USD}`);
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
