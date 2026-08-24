/**
 * Group View collection: read public Facebook groups, store their posts.
 *
 * Built on the same scrapeSync trigger-and-poll primitive the brand collectors
 * use, so a group that outlives its serverless invocation resumes from its
 * Bright Data snapshot receipt rather than paying twice. Groups are org-private
 * and settled through group_collection_state, one row per group, claimed under
 * a lease.
 *
 * The one rule specific to groups: Bright Data's group dataset returns PUBLIC
 * group posts. A members-only group yields no rows (or a vendor error naming
 * access), and that settles `ineligible` — the tool does not attempt to reach
 * private content, and says so on the group rather than retrying forever.
 * See docs/GROUP-VIEW.md.
 */
import { sql } from 'drizzle-orm';
import { db } from '@/db';
import { groupPosts } from '@/db/schema';
import { scrapeSync, DATASETS, rowError } from '@/lib/vendors/brightdata';
import { PendingSnapshotError } from '@/lib/vendors/brightdata';
import {
  GROUP_DAILY_RECORD_BUDGET, estimateBrightDataCents, recordSpend, remainingRecordBudget,
} from '@/lib/vendors/budget';

const LEASE_MINUTES = 8;
const GROUPS_PER_TICK = 8;
const MAX_ATTEMPTS = 6;

/**
 * Vendor error text that actually establishes the group cannot be read, as
 * opposed to a scrape that has not finished. Nothing else may be reported to a
 * user as "private".
 */
const ACCESS_REFUSAL = /private|not (a )?(public|member)|members[- ]only|access denied|permission|log ?in required|restricted/i;

/** Platform media/CDN hosts, which are attachments rather than shared links. */
const MEDIA_HOST = /(^|\.)(fbcdn\.net|cdninstagram\.com|akamaihd\.net|licdn\.com|twimg\.com|ytimg\.com)$/i;

/**
 * Records bought per group per round, enforced by the vendor.
 *
 * This number used to be passed as `num_of_posts` in the request body, next to
 * a two-day `start_date`, and I reported the spend as capped on that basis. It
 * was not. This dataset accepts both fields and ignores both: the last round
 * asked for fifty posts each from a two-day window and was delivered 31,235,
 * 18,397 and 7,405 records reaching back to July 2018, then billed for all of
 * them. Roughly $85 a round, every six hours, which is the $232 invoice.
 *
 * `limit_per_input` is a trigger query parameter that Bright Data applies
 * before delivery, so it caps the invoice instead of requesting politely that
 * it be small. Verified against the live dataset: a limit of five returned
 * exactly five records, newest first. Newest-first is what makes the cap
 * sufficient on its own — a date window would be redundant even if it worked.
 *
 * Seventy-five per group per round, four rounds a day, is 300 records of
 * headroom against the 60 to 110 posts a day these groups actually produce.
 */
const POSTS_PER_GROUP = 75;

/** Hours between rounds for a group that collected cleanly. */
const RECOLLECT_HOURS = 6;

export interface GroupCollectResult {
  groupsClaimed: number;
  postsWritten: number;
  covered: number;
  ineligible: number;
  failed: number;
  /** Records the vendor delivered and billed for, which is not postsWritten. */
  recordsBought: number;
  estimatedCents: number;
  /** Set when the rolling record budget stopped this tick short. */
  budgetExhausted: boolean;
}

interface RawGroupPost {
  post_id?: unknown;
  url?: unknown;
  content?: unknown;
  date_posted?: unknown;
  user_username_raw?: unknown;
  user_url?: unknown;
  likes?: unknown;
  num_comments?: unknown;
  num_shares?: unknown;
  attachments?: unknown;
}

function str(v: unknown): string | null {
  return typeof v === 'string' && v.trim() ? v.trim() : null;
}
function int(v: unknown): number {
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? Math.max(0, Math.trunc(n)) : 0;
}
/** Parse the vendor's date_posted string into a Date, or null if unusable. */
function date(v: unknown): Date | null {
  const s = str(v);
  if (!s) return null;
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d;
}

/**
 * Outbound links a post carries, for distribution analysis.
 *
 * The dataset packs links inside `content` and sometimes `attachments`; we pull
 * http(s) URLs from the text and keep the registrable host alongside the raw
 * link so the aggregate "whose links travel" view never has to re-parse.
 */
function extractUrls(content: string | null, attachments: unknown): { url: string; domain: string }[] {
  const found = new Map<string, string>();
  const add = (raw: string) => {
    try {
      const u = new URL(raw);
      if (u.protocol !== 'http:' && u.protocol !== 'https:') return;
      const domain = u.hostname.replace(/^www\./, '');
      // Platform media hosts are not "links that travel". Every photo in every
      // post carries an fbcdn URL, so counting them buried real publisher
      // domains under nine CDN shards and made the panel meaningless.
      if (MEDIA_HOST.test(domain)) return;
      if (!found.has(u.href)) found.set(u.href, domain);
    } catch { /* not a URL */ }
  };
  if (content) for (const m of content.matchAll(/https?:\/\/[^\s)]+/g)) add(m[0]);
  if (Array.isArray(attachments)) {
    for (const a of attachments) {
      if (a && typeof a === 'object' && 'url' in a) {
        const u = str((a as { url?: unknown }).url);
        if (u) add(u);
      }
    }
  }
  return [...found].map(([url, domain]) => ({ url, domain }));
}

/** Claim up to GROUPS_PER_TICK groups needing collection, under a lease. */
async function claimGroups(orgId: string): Promise<{ id: string; url: string; resume: string | null }[]> {
  const { rows } = await db.execute<{ id: string; url: string; resume_snapshot_id: string | null }>(sql`
    WITH due AS (
      SELECT g.id, g.url
        FROM watched_groups g
        LEFT JOIN group_collection_state s ON s.group_id = g.id
       WHERE g.org_id = ${orgId} AND g.active
         AND (
           s.group_id IS NULL
           OR (s.status <> 'collecting' AND coalesce(s.next_attempt_at, now()) <= now()
               AND (s.outcome IS DISTINCT FROM 'ineligible')
               AND s.attempts < ${MAX_ATTEMPTS})
           OR (s.status = 'collecting' AND s.next_attempt_at <= now())
         )
       ORDER BY coalesce(s.last_collected_at, to_timestamp(0)) ASC
       LIMIT ${GROUPS_PER_TICK}
       FOR UPDATE OF g SKIP LOCKED
    )
    INSERT INTO group_collection_state (group_id, status, next_attempt_at, updated_at)
    SELECT due.id, 'collecting', now() + interval '${sql.raw(String(LEASE_MINUTES))} minutes', now()
      FROM due
    ON CONFLICT (group_id) DO UPDATE
      SET status = 'collecting',
          next_attempt_at = now() + interval '${sql.raw(String(LEASE_MINUTES))} minutes',
          updated_at = now()
    RETURNING group_id AS id,
              (SELECT url FROM watched_groups WHERE id = group_collection_state.group_id) AS url,
              resume_snapshot_id`);
  return rows.map((r) => ({ id: r.id, url: r.url, resume: r.resume_snapshot_id }));
}

async function settle(
  groupId: string,
  outcome: 'covered' | 'ineligible' | 'failed',
  opts: { error?: string; resume?: string | null } = {},
): Promise<void> {
  await db.execute(sql`
    UPDATE group_collection_state
       SET status = 'idle',
           outcome = ${outcome},
           attempts = CASE WHEN ${outcome} = 'failed' THEN attempts + 1 ELSE 0 END,
           next_attempt_at = CASE
             WHEN ${outcome} = 'failed'
               THEN now() + make_interval(mins => 30 * power(2, least(attempts, 5))::int)
             WHEN ${outcome} = 'ineligible' THEN NULL
             ELSE now() + make_interval(hours => ${RECOLLECT_HOURS}) END,
           resume_snapshot_id = ${opts.resume ?? null},
           last_error = ${opts.error ?? null},
           last_collected_at = CASE WHEN ${outcome} = 'covered' THEN now() ELSE last_collected_at END,
           updated_at = now()
     WHERE group_id = ${groupId}`);
}

async function writePosts(orgId: string, groupId: string, rows: RawGroupPost[]): Promise<number> {
  const values = rows
    .map((r) => {
      const externalId = str(r.post_id);
      if (!externalId) return null;
      const content = str(r.content);
      return {
        orgId,
        groupId,
        externalId,
        postedAt: date(r.date_posted),
        content,
        authorName: str(r.user_username_raw),
        authorProfileUrl: str(r.user_url),
        likes: int(r.likes),
        comments: int(r.num_comments),
        shares: int(r.num_shares),
        permalink: str(r.url),
        urls: extractUrls(content, r.attachments),
        // The full vendor record is deliberately not retained. Keeping it grew
        // group_posts to 238MB for 59k rows, on a database that hit its storage
        // ceiling earlier this month, and every field the product reads is
        // already extracted into typed columns above.
        raw: null,
      };
    })
    .filter((v): v is NonNullable<typeof v> => v !== null);

  if (values.length === 0) return 0;

  // A busy group returns tens of thousands of rows in one snapshot. Passing
  // them to a single INSERT exceeded both the JS call stack and Postgres's
  // 65,535 bind-parameter ceiling, so every row was lost. Fourteen columns per
  // row means 500 rows is ~7,000 parameters: comfortably inside both limits.
  const CHUNK = 500;
  let written = 0;
  for (let i = 0; i < values.length; i += CHUNK) {
    const chunk = values.slice(i, i + CHUNK);
    await db.insert(groupPosts).values(chunk).onConflictDoNothing();
    written += chunk.length;
  }
  return written;
}

/** One org's group-collection tick. */
export async function runGroupCollection(orgId: string, apiKey: string): Promise<GroupCollectResult> {
  const result: GroupCollectResult = {
    groupsClaimed: 0, postsWritten: 0, covered: 0, ineligible: 0, failed: 0,
    recordsBought: 0, estimatedCents: 0, budgetExhausted: false,
  };

  // Ask the ledger before buying anything. The vendor cap below is the primary
  // defence and it is verified; this is the second one, for the day the vendor
  // changes behaviour without telling us. Its job is to make that day cost a
  // few dollars instead of a few hundred.
  let budget = await remainingRecordBudget('brightdata', GROUP_DAILY_RECORD_BUDGET);
  if (budget < POSTS_PER_GROUP) {
    result.budgetExhausted = true;
    console.warn('[data-dumpster:groups] daily record budget exhausted, buying nothing', {
      orgId, budgetRemaining: budget, dailyBudget: GROUP_DAILY_RECORD_BUDGET,
    });
    return result;
  }

  const groups = await claimGroups(orgId);
  result.groupsClaimed = groups.length;

  for (const group of groups) {
    if (budget < POSTS_PER_GROUP && !group.resume) {
      // Out of budget mid-tick. Release the claim so the next tick picks this
      // group up rather than leaving it leased and looking stuck. A resume is
      // exempt: that snapshot is already paid for, and abandoning it would
      // forfeit the spend and buy it again later.
      result.budgetExhausted = true;
      await db.execute(sql`
        UPDATE group_collection_state
           SET status = 'idle', next_attempt_at = now() + interval '1 hour', updated_at = now()
         WHERE group_id = ${group.id}`);
      continue;
    }
    try {
      // This dataset is url_collection only: the group URL IS the input and
      // Bright Data returns that group's posts. It rejects discovery mode
      // (type=discover_new) with an HTTP 400, so no discoverBy here.
      //
      // No date window and no num_of_posts in the body. Both are accepted and
      // both are ignored by this dataset, which is how a round meant to buy 150
      // records bought 57,037. limitPerInput becomes a trigger query parameter
      // the vendor applies before delivery, and returns newest posts first.
      const rows = await scrapeSync<RawGroupPost>(
        DATASETS.facebookGroupPosts,
        [{ url: group.url }],
        {
          apiKey,
          platform: 'facebook',
          resumeSnapshotId: group.resume ?? undefined,
          limitPerInput: POSTS_PER_GROUP,
          limitTotal: POSTS_PER_GROUP,
          timeoutMs: 60_000,
        },
      );
      // Only the vendor saying so establishes that a group is unreachable.
      // Zero rows does NOT: a slow snapshot, a transient vendor hiccup and a
      // genuinely members-only group all produce it, and calling all three
      // "private" put a false claim on the screen for public groups. So an
      // access refusal is read from the vendor's own error text, and anything
      // else retries.
      const refusal = rows.map(rowError).find((m) => m && ACCESS_REFUSAL.test(m));
      if (refusal) {
        await settle(group.id, 'ineligible', { error: refusal.slice(0, 500) });
        result.ineligible += 1;
        continue;
      }
      if (rows.length === 0) {
        await settle(group.id, 'failed', {
          error: 'Bright Data returned no rows for this group yet. Retrying.',
        });
        result.failed += 1;
        continue;
      }
      const written = await writePosts(orgId, group.id, rows);

      // Write the purchase down before anything else can fail. The vendor
      // billed for `rows.length` whether or not we kept them, and the whole
      // point of the ledger is that it reflects the invoice rather than our
      // intentions. A cap the vendor stopped honouring would surface here as
      // a records count far above POSTS_PER_GROUP.
      const cents = estimateBrightDataCents(rows.length);
      budget -= rows.length;
      result.recordsBought += rows.length;
      result.estimatedCents += cents;
      result.postsWritten += written;
      await recordSpend({
        orgId,
        vendor: 'brightdata',
        resource: DATASETS.facebookGroupPosts,
        subject: group.url,
        records: rows.length,
        stored: written,
        estimatedCents: cents,
      });
      if (rows.length > POSTS_PER_GROUP * 2) {
        console.error('[data-dumpster:groups] vendor exceeded its own record cap', {
          orgId, group: group.url, asked: POSTS_PER_GROUP, delivered: rows.length,
        });
      }
      await settle(group.id, 'covered');
      result.covered += 1;
    } catch (err) {
      if (err instanceof PendingSnapshotError) {
        // Not finished; keep the receipt and let the next tick resume it.
        await db.execute(sql`
          UPDATE group_collection_state
             SET status = 'idle', outcome = 'collecting',
                 resume_snapshot_id = ${err.snapshotId},
                 next_attempt_at = now() + interval '2 minutes', updated_at = now()
           WHERE group_id = ${group.id}`);
        continue;
      }
      await settle(group.id, 'failed', {
        error: (err instanceof Error ? err.message : String(err)).slice(0, 500),
      });
      result.failed += 1;
    }
  }
  return result;
}
