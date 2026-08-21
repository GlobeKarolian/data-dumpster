/**
 * Drain the AI tagging backlog in one sitting.
 *
 * This is deliberately NOT a new tagging implementation. It calls the same
 * `runTaggingTick` the cron calls, so every post it writes is identical to one
 * the scheduler would have written: same model, same taxonomy fingerprint, same
 * validation, same settle. The only things it changes are concurrency (the
 * serverless tick is capped at 300s; this is not) and the daily budget gate,
 * which is replaced by a hard ceiling below.
 *
 * THE CEILING IS THE POINT. It is measured against ai_usage in the database
 * rather than a running total in memory, because a crashed or duplicated worker
 * must not be able to spend past it, and it aborts the whole run rather than
 * throttling. Set it with BACKFILL_MAX_USD.
 *
 *   npx tsx scripts/backfill-tags.ts
 */
import { sql } from 'drizzle-orm';
import { db } from '../src/db';
import { orgsWithAiTags, runTaggingTick } from '../src/lib/tagging/queue';

const MAX_USD = Number(process.env.BACKFILL_MAX_USD ?? 60);
const WORKERS = Number(process.env.BACKFILL_WORKERS ?? 8);
/** Stop when this many consecutive ticks claim nothing: the queue is drained. */
const IDLE_LIMIT = 3;

const startedAt = new Date();

async function spentSinceStartUsd(): Promise<number> {
  const { rows } = await db.execute<{ usd: string | number | null }>(sql`
    SELECT coalesce(sum(cost_usd), 0) AS usd
      FROM ai_usage
     WHERE feature = 'post-tagging'
       AND created_at >= ${startedAt.toISOString()}`);
  return Number(rows[0]?.usd ?? 0);
}

async function remaining(): Promise<number> {
  const { rows } = await db.execute<{ n: string | number }>(sql`
    SELECT count(*) AS n
      FROM posts p
      LEFT JOIN ai_tag_state s ON s.post_id = p.id
     WHERE s.post_id IS NULL`);
  return Number(rows[0]?.n ?? 0);
}

let aborted = false;
let idleStreak = 0;
const totals = { ticks: 0, claimed: 0, tagged: 0, assignments: 0, failed: 0 };

async function worker(orgIds: string[], id: number): Promise<void> {
  while (!aborted) {
    let claimedThisRound = 0;
    for (const orgId of orgIds) {
      if (aborted) return;
      try {
        const r = await runTaggingTick(orgId);
        totals.ticks += 1;
        totals.claimed += r.claimed;
        totals.tagged += r.tagged;
        totals.assignments += r.assignmentsWritten;
        totals.failed += r.failed;
        claimedThisRound += r.claimed;
      } catch (err) {
        console.error(`  worker ${id} tick error:`, err instanceof Error ? err.message : err);
      }
    }
    if (claimedThisRound === 0) {
      idleStreak += 1;
      if (idleStreak >= IDLE_LIMIT) return;
      await new Promise((r) => setTimeout(r, 1500));
    } else {
      idleStreak = 0;
    }
  }
}

/** Independent of the workers: the ceiling must hold even if a worker wedges. */
async function guard(): Promise<void> {
  while (!aborted) {
    await new Promise((r) => setTimeout(r, 10_000));
    const spent = await spentSinceStartUsd();
    const left = await remaining();
    console.log(
      `  spent $${spent.toFixed(2)} / $${MAX_USD} · untagged left ${left.toLocaleString()}`
      + ` · tagged ${totals.tagged.toLocaleString()} · assignments ${totals.assignments.toLocaleString()}`
      + ` · failed ${totals.failed}`,
    );
    if (spent >= MAX_USD) {
      aborted = true;
      console.log(`\nCEILING REACHED at $${spent.toFixed(2)}. Stopping.`);
      return;
    }
    if (idleStreak >= IDLE_LIMIT) return;
  }
}

async function main(): Promise<void> {
  // The tick's own daily gate would stop this after $5. The ceiling above
  // replaces it for this process only; production config is untouched.
  process.env.AI_TAGGING_DAILY_USD = String(MAX_USD * 10);

  const orgIds = await orgsWithAiTags();
  const before = await remaining();
  console.log(`Backfill starting: ${before.toLocaleString()} untagged posts`);
  console.log(`Orgs: ${orgIds.length} · workers: ${WORKERS} · ceiling: $${MAX_USD}\n`);
  if (orgIds.length === 0) { console.log('No orgs with AI-eligible tags.'); return; }

  const guardTask = guard();
  await Promise.all(
    Array.from({ length: WORKERS }, (_, i) => worker(orgIds, i + 1)),
  );
  aborted = true;
  await guardTask;

  const spent = await spentSinceStartUsd();
  const after = await remaining();
  console.log('\n=== BACKFILL COMPLETE ===');
  console.log(`  posts tagged this run : ${totals.tagged.toLocaleString()}`);
  console.log(`  assignments written   : ${totals.assignments.toLocaleString()}`);
  console.log(`  failed                : ${totals.failed.toLocaleString()}`);
  console.log(`  untagged before/after : ${before.toLocaleString()} -> ${after.toLocaleString()}`);
  console.log(`  spent                 : $${spent.toFixed(2)} of $${MAX_USD} ceiling`);
}

main()
  .then(() => process.exit(0))
  .catch((err) => { console.error(err); process.exit(1); });
