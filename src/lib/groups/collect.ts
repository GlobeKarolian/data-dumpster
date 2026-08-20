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

const LEASE_MINUTES = 8;
const GROUPS_PER_TICK = 8;
const MAX_ATTEMPTS = 6;

/**
 * Vendor error text that actually establishes the group cannot be read, as
 * opposed to a scrape that has not finished. Nothing else may be reported to a
 * user as "private".
 */
const ACCESS_REFUSAL = /private|not (a )?(public|member)|members[- ]only|access denied|permission|log ?in required|restricted/i;

/**
 * Vendor spend governor: how far back and how many posts we buy per group.
 *
 * Deliberately small. Collection runs every six hours, so a two-day window
 * overlaps itself and nothing is missed, while the per-run bill stays in cents
 * rather than the ~$50 an unbounded group snapshot cost. Group View is a
 * "what is being discussed now" tool; history accrues from our own daily
 * collection rather than being bought back.
 */
const WINDOW_DAYS = 2;
const POSTS_PER_GROUP = 50;

/** MM-DD-YYYY, the format this dataset's date inputs expect. */
function windowStart(): string {
  const d = new Date(Date.now() - WINDOW_DAYS * 24 * 60 * 60 * 1000);
  const p = (n: number) => String(n).padStart(2, '0');
  return p(d.getMonth() + 1) + '-' + p(d.getDate()) + '-' + d.getFullYear();
}

export interface GroupCollectResult {
  groupsClaimed: number;
  postsWritten: number;
  covered: number;
  ineligible: number;
  failed: number;
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
             ELSE now() + interval '6 hours' END,
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
        raw: r as Record<string, unknown>,
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
  };
  const groups = await claimGroups(orgId);
  result.groupsClaimed = groups.length;

  for (const group of groups) {
    try {
      // This dataset is url_collection only: the group URL IS the input and
      // Bright Data returns that group's posts. It rejects discovery mode
      // (type=discover_new) with an HTTP 400, so no discoverBy here.
      //
      // The window is not optional. Unbounded, one busy group returned 33,226
      // records in a single snapshot, which is roughly $50 at $1.50/1,000 —
      // per group, per collection, every six hours. Group View is a "what is
      // being discussed now" tool, so it buys a recent window and nothing more.
      const rows = await scrapeSync<RawGroupPost>(
        DATASETS.facebookGroupPosts,
        [{
          url: group.url,
          start_date: windowStart(),
          end_date: '',
          num_of_posts: POSTS_PER_GROUP,
        }],
        {
          apiKey,
          platform: 'facebook',
          resumeSnapshotId: group.resume ?? undefined,
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
      result.postsWritten += written;
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
