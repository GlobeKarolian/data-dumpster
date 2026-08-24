/**
 * Give back the retries that a billing outage took away.
 *
 * On 24 August the OpenRouter account ran out of credits at 06:00 UTC. Within
 * the hour, 62,431 rows in ai_tag_state had spent all six of their retries on
 * HTTP 402, a condition no retry could ever fix. The claim query requires
 * `attempts < MAX_TAGGING_ATTEMPTS`, so every one of those posts was parked
 * permanently: funding the account would not have restarted a single one, and
 * the queue would have reported itself idle with 8,407 posts never read.
 *
 * The queue no longer spends attempts on billing failures. This repairs the
 * rows that were already spent, and only those: a row is reset only when its
 * last error was a billing error, so a post that genuinely cannot be parsed
 * keeps its exhausted attempts and stays out of the queue.
 *
 * Safe to run more than once. Run after the account is funded.
 *
 *   npx tsx --env-file=.env.local scripts/repair-billing-parked-tags.ts
 *   npx tsx --env-file=.env.local scripts/repair-billing-parked-tags.ts --apply
 */
import { sql } from 'drizzle-orm';
import { db } from '@/db';

const BILLING = '(402|requires more credits|exceed your available credits'
  + '|insufficient (credit|balance|funds)|quota exceeded)';

async function main(): Promise<void> {
  const apply = process.argv.includes('--apply');

  for (const table of ['ai_tag_state', 'group_tag_state'] as const) {
    const { rows } = await db.execute<{
      parked: string | number; never_tagged: string | number; other_failures: string | number;
    }>(sql`
      SELECT
        count(*) FILTER (WHERE status = 'failed' AND last_error ~* ${BILLING}) AS parked,
        count(*) FILTER (WHERE status = 'failed' AND last_error ~* ${BILLING}
                           AND tagged_at IS NULL) AS never_tagged,
        count(*) FILTER (WHERE status = 'failed' AND last_error !~* ${BILLING}) AS other_failures
        FROM ${sql.raw(table)}`);
    const r = rows[0];
    console.log(
      table + ': ' + Number(r?.parked ?? 0) + ' parked on billing ('
      + Number(r?.never_tagged ?? 0) + ' never tagged at all), '
      + Number(r?.other_failures ?? 0) + ' failed for other reasons and are left alone.',
    );

    if (!apply) continue;
    const { rows: done } = await db.execute<{ n: string | number }>(sql`
      WITH reset AS (
        UPDATE ${sql.raw(table)}
           SET attempts = 0, next_attempt_at = now(), updated_at = now()
         WHERE status = 'failed' AND last_error ~* ${BILLING}
        RETURNING 1
      ) SELECT count(*) AS n FROM reset`);
    console.log('  reset ' + Number(done[0]?.n ?? 0) + ' rows to attempts = 0, due now.');
  }

  if (!apply) console.log('\nDry run. Pass --apply to write.');
}

main().then(() => process.exit(0)).catch((err) => {
  console.error(err);
  process.exit(1);
});
