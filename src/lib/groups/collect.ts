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
import { scrapeSync, DATASETS } from '@/lib/vendors/brightdata';
import { PendingSnapshotError } from '@/lib/vendors/brightdata';

const LEASE_MINUTES = 8;
const GROUPS_PER_TICK = 8;
const MAX_ATTEMPTS = 6;

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
  await db.insert(groupPosts).values(values).onConflictDoNothing();
  return values.length;
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
      const rows = await scrapeSync<RawGroupPost>(
        DATASETS.facebookGroupPosts,
        [{ url: group.url }],
        {
          apiKey,
          platform: 'facebook',
          discoverBy: 'url',
          resumeSnapshotId: group.resume ?? undefined,
          timeoutMs: 60_000,
        },
      );
      // A public group with no returned rows is empty or unreadable; a
      // members-only group is the latter, and neither is a failure to retry.
      if (rows.length === 0) {
        await settle(group.id, 'ineligible', { error: 'No public posts returned for this group URL.' });
        result.ineligible += 1;
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
