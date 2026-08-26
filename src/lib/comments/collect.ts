/**
 * Comment collection: buy the comments under our pooled posts.
 *
 * Why comments at all: the earliest signal of an emerging theme lives under
 * posts, not in them, and nobody can read fifty comment sections a day.
 * Instagram went first because its whole corpus runs about $2 a day; TikTok
 * joined a day later once its dataset was probed, and its sections turn out
 * to be an order of magnitude louder (a Boston 25 Clancy video's top comment
 * carries 2,953 likes against Instagram's 339 high-water mark).
 *
 * The collection contract, same as groups, fourth copy of the pattern:
 * claim under a lease, settle with an outcome, resume an unfinished snapshot
 * by its receipt, write every purchase to the ledger before anything else can
 * fail. The caps are vendor-enforced trigger parameters, which are the only
 * caps that bind. Each platform spends its own daily record budget, so a
 * loud TikTok day cannot starve Instagram or vice versa.
 *
 * v1 policy: one pass per post, half a day after posting so comments have
 * accrued, busiest posts first. A settled post is never bought again.
 */
import { sql } from 'drizzle-orm';
import { db } from '@/db';
import { postComments } from '@/db/schema';
import { scrapeSync, DATASETS, PendingSnapshotError } from '@/lib/vendors/brightdata';
import {
  IG_COMMENT_DAILY_RECORD_BUDGET, TIKTOK_COMMENT_DAILY_RECORD_BUDGET,
  estimateBrightDataCents, recordSpend, remainingRecordBudget,
} from '@/lib/vendors/budget';

const LEASE_MINUTES = 8;
const POSTS_PER_PLATFORM_PER_TICK = 5;
const MAX_ATTEMPTS = 5;

/** The platforms whose comment sections we buy, each on its own budget. */
const PLATFORM_CONFIGS = [
  {
    platform: 'instagram' as const,
    dataset: DATASETS.instagramComments,
    dailyBudget: IG_COMMENT_DAILY_RECORD_BUDGET,
  },
  {
    platform: 'tiktok' as const,
    dataset: DATASETS.tiktokComments,
    dailyBudget: TIKTOK_COMMENT_DAILY_RECORD_BUDGET,
  },
];

/**
 * Records bought per post. The dataset returns newest first, so this reads as
 * "the hundred most recent comments," which for theme detection is the sample
 * that matters. Instagram posts in this corpus report a median well under
 * this; the cap exists for the tail and for the day the vendor misbehaves.
 */
export const COMMENTS_PER_POST = 100;

/** Comments accrue for a while; buying too early buys an empty section. */
const MIN_POST_AGE_HOURS = 12;
/** And a week later the section is settled and the news value is gone. */
const MAX_POST_AGE_DAYS = 7;

export interface CommentCollectResult {
  postsClaimed: number;
  commentsWritten: number;
  covered: number;
  failed: number;
  recordsBought: number;
  estimatedCents: number;
  budgetExhausted: boolean;
}

/**
 * Union of the two vendors' comment shapes, both captured by live probes
 * rather than docs. Instagram (25 Aug): comment_user / comment /
 * likes_number / comment_date. TikTok (26 Aug): commenter_user_name /
 * comment_text / num_likes / date_created. The key sets do not collide, so
 * one parser with fallbacks reads both.
 */
interface RawComment {
  comment_id?: unknown;
  comment_user?: unknown;
  commenter_user_name?: unknown;
  comment_user_url?: unknown;
  commenter_url?: unknown;
  comment_date?: unknown;
  date_created?: unknown;
  comment?: unknown;
  comment_text?: unknown;
  likes_number?: unknown;
  num_likes?: unknown;
  replies_number?: unknown;
  num_replies?: unknown;
}

function str(v: unknown): string | null {
  return typeof v === 'string' && v.trim() ? v.trim() : null;
}
function int(v: unknown): number {
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? Math.max(0, Math.trunc(n)) : 0;
}
function date(v: unknown): Date | null {
  const s = str(v);
  if (!s) return null;
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** One vendor record to one row, or null when it carries no stable id. */
export function parseComment(postId: string, r: RawComment): {
  postId: string; externalId: string; authorName: string | null; authorUrl: string | null;
  text: string | null; likes: number; replies: number; commentedAt: Date | null;
} | null {
  const externalId = str(r.comment_id);
  if (!externalId) return null;
  return {
    postId,
    externalId,
    authorName: str(r.comment_user) ?? str(r.commenter_user_name),
    authorUrl: str(r.comment_user_url) ?? str(r.commenter_url),
    text: str(r.comment) ?? str(r.comment_text),
    likes: r.likes_number !== undefined ? int(r.likes_number) : int(r.num_likes),
    replies: r.replies_number !== undefined ? int(r.replies_number) : int(r.num_replies),
    commentedAt: date(r.comment_date) ?? date(r.date_created),
  };
}

/**
 * Claim Instagram posts whose comment sections are due, busiest first.
 * Busiest-first is the sampling argument made concrete: with a bounded daily
 * budget, the hundred comments under the post everyone is arguing about are
 * worth more than the four under a quiet one.
 */
async function claimPosts(
  platform: string,
  limit: number,
): Promise<{ id: string; permalink: string; resume: string | null }[]> {
  const { rows } = await db.execute<{
    id: string; permalink: string; resume_snapshot_id: string | null;
  }>(sql`
    WITH due AS (
      SELECT p.id, p.permalink
        FROM posts p
        JOIN channels c ON c.id = p.channel_id
        LEFT JOIN comment_collection_state s ON s.post_id = p.id
       WHERE c.platform = ${platform}
         AND p.permalink IS NOT NULL
         AND p.conversation >= 1
         AND p.posted_at <= now() - make_interval(hours => ${MIN_POST_AGE_HOURS})
         AND p.posted_at >= now() - make_interval(days => ${MAX_POST_AGE_DAYS})
         AND (
           s.post_id IS NULL
           OR (s.status <> 'collecting' AND s.outcome = 'failed'
               AND coalesce(s.next_attempt_at, now()) <= now()
               AND s.attempts < ${MAX_ATTEMPTS})
           OR (s.status = 'collecting' AND s.next_attempt_at <= now())
           -- Parked mid-collection: the snapshot is paid for and cooking on the
           -- vendor's side. Without this branch a parked post was orphaned
           -- forever, which no Instagram post ever surfaced (their dataset
           -- answers inline) and every TikTok post did (theirs never does).
           OR (s.status = 'idle' AND s.outcome = 'collecting'
               AND coalesce(s.next_attempt_at, now()) <= now())
         )
       -- Harvest bought snapshots before triggering new spend.
       ORDER BY (s.resume_snapshot_id IS NOT NULL) DESC, p.conversation DESC
       LIMIT ${limit}
       FOR UPDATE OF p SKIP LOCKED
    )
    INSERT INTO comment_collection_state (post_id, status, next_attempt_at, updated_at)
    SELECT due.id, 'collecting', now() + make_interval(mins => ${LEASE_MINUTES}), now()
      FROM due
    ON CONFLICT (post_id) DO UPDATE
      SET status = 'collecting',
          next_attempt_at = now() + make_interval(mins => ${LEASE_MINUTES}),
          updated_at = now()
    RETURNING post_id AS id,
              (SELECT permalink FROM posts WHERE id = comment_collection_state.post_id) AS permalink,
              resume_snapshot_id`);
  return rows.map((r) => ({ id: r.id, permalink: r.permalink, resume: r.resume_snapshot_id }));
}

async function settle(
  postId: string,
  outcome: 'covered' | 'failed',
  opts: { error?: string } = {},
): Promise<void> {
  await db.execute(sql`
    UPDATE comment_collection_state
       SET status = 'idle',
           outcome = ${outcome},
           attempts = CASE WHEN ${outcome} = 'failed' THEN attempts + 1 ELSE 0 END,
           -- A covered post is done forever under the one-pass policy.
           next_attempt_at = CASE
             WHEN ${outcome} = 'failed'
               THEN now() + make_interval(mins => 30 * power(2, least(attempts, 5))::int)
             ELSE NULL END,
           resume_snapshot_id = NULL,
           last_error = ${opts.error ?? null},
           last_collected_at = CASE WHEN ${outcome} = 'covered' THEN now() ELSE last_collected_at END,
           updated_at = now()
     WHERE post_id = ${postId}`);
}

async function writeComments(postId: string, rows: RawComment[]): Promise<number> {
  const values = rows
    .map((r) => parseComment(postId, r))
    .filter((v): v is NonNullable<typeof v> => v !== null);
  if (values.length === 0) return 0;
  // 8 columns x 100 rows stays far inside the bind-parameter ceiling, but the
  // chunking habit costs nothing and the day a cap fails it saves the write.
  const CHUNK = 500;
  let written = 0;
  for (let i = 0; i < values.length; i += CHUNK) {
    await db.insert(postComments).values(values.slice(i, i + CHUNK)).onConflictDoNothing();
    written += Math.min(CHUNK, values.length - i);
  }
  return written;
}

/** One comment-collection tick, global: comments on pooled posts are pooled. */
export async function runCommentCollection(apiKey: string): Promise<CommentCollectResult> {
  const result: CommentCollectResult = {
    postsClaimed: 0, commentsWritten: 0, covered: 0, failed: 0,
    recordsBought: 0, estimatedCents: 0, budgetExhausted: false,
  };

  for (const config of PLATFORM_CONFIGS) {
    let budget = await remainingRecordBudget(
      'brightdata', config.dailyBudget, 24, config.dataset,
    );
    if (budget < COMMENTS_PER_POST) {
      result.budgetExhausted = true;
      console.warn('[data-dumpster:comments] daily record budget exhausted for platform', {
        platform: config.platform, budgetRemaining: budget, dailyBudget: config.dailyBudget,
      });
      continue;
    }

    const claimed = await claimPosts(config.platform, POSTS_PER_PLATFORM_PER_TICK);
    result.postsClaimed += claimed.length;

    for (const post of claimed) {
      if (budget < COMMENTS_PER_POST && !post.resume) {
        result.budgetExhausted = true;
        await db.execute(sql`
          UPDATE comment_collection_state
             SET status = 'idle', next_attempt_at = now() + interval '1 hour', updated_at = now()
           WHERE post_id = ${post.id}`);
        continue;
      }
      try {
        const rows = await scrapeSync<RawComment>(
          config.dataset,
          [{ url: post.permalink }],
          {
            apiKey,
            platform: config.platform,
            resumeSnapshotId: post.resume ?? undefined,
            limitPerInput: COMMENTS_PER_POST,
            limitTotal: COMMENTS_PER_POST,
            timeoutMs: 60_000,
          },
        );

        const written = await writeComments(post.id, rows);
        const cents = estimateBrightDataCents(rows.length);
        budget -= rows.length;
        result.recordsBought += rows.length;
        result.estimatedCents += cents;
        result.commentsWritten += written;
        await recordSpend({
          vendor: 'brightdata',
          resource: config.dataset,
          subject: post.permalink,
          records: rows.length,
          stored: written,
          estimatedCents: cents,
        });
        if (rows.length > COMMENTS_PER_POST * 2) {
          console.error('[data-dumpster:comments] vendor exceeded its own record cap', {
            platform: config.platform, post: post.permalink,
            asked: COMMENTS_PER_POST, delivered: rows.length,
          });
        }
        // Zero comments settles covered, not failed: a post whose commenters
        // deleted everything, or whose count was bot inflation, is a fact.
        await settle(post.id, 'covered');
        result.covered += 1;
      } catch (err) {
        if (err instanceof PendingSnapshotError) {
          await db.execute(sql`
            UPDATE comment_collection_state
               SET status = 'idle', outcome = 'collecting',
                   resume_snapshot_id = ${err.snapshotId},
                   next_attempt_at = now() + interval '2 minutes', updated_at = now()
             WHERE post_id = ${post.id}`);
          continue;
        }
        await settle(post.id, 'failed', {
          error: (err instanceof Error ? err.message : String(err)).slice(0, 500),
        });
        result.failed += 1;
      }
    }
  }
  return result;
}
