/**
 * The durable half of AI tagging: claim, complete, settle.
 *
 * Shape borrowed from the collection queue, which has survived contact with
 * production: state rows claimed with SKIP LOCKED under a lease, settled with
 * an outcome, retried with backoff. Differences are simplifications — a post
 * either tags or it does not; there is no pagination and no receipts.
 *
 * Write order inside a batch (Neon HTTP, no transactions): delete stale ai
 * assignments → insert new ones → settle state LAST. State is the cursor. A
 * crash mid-batch leaves claimed rows to lease-expire and re-run, and re-
 * running is idempotent because the first step clears previous ai rows.
 * See docs/AI-TAGGING.md.
 */
import { and, eq, inArray, sql } from 'drizzle-orm';
import { db } from '@/db';
import { postTagAssignments, postTags } from '@/db/schema';
import { complete } from '@/lib/ai/client';
import { ModelError } from '@/lib/ai/types';
import {
  buildTaggingMessages,
  MAX_TAGGING_ATTEMPTS,
  TAGGING_SCHEMA,
  taxonomyFingerprint,
  validateAssignments,
  type AiTagDefinition,
  type TaggablePostContent,
} from './ai-tagger';

const POSTS_PER_COMPLETION = 20;
/** Lease long enough for one model call with retries, short enough to recover. */
const LEASE_MINUTES = 10;
const DAILY_USD_DEFAULT = 5;

export interface TagTickResult {
  orgId: string;
  fingerprint: string;
  claimed: number;
  tagged: number;
  assignmentsWritten: number;
  droppedByValidation: number;
  failed: number;
  spentUsd: number;
  budgetExhausted: boolean;
  skipped?: string;
}

/** Orgs with at least one AI-eligible tag; nothing to do for anyone else. */
export async function orgsWithAiTags(): Promise<string[]> {
  const rows = await db
    .selectDistinct({ orgId: postTags.orgId })
    .from(postTags)
    .where(sql`${postTags.aiPrompt} IS NOT NULL AND btrim(${postTags.aiPrompt}) <> ''`);
  return rows.map((r) => r.orgId);
}

export async function aiTagsForOrg(orgId: string): Promise<AiTagDefinition[]> {
  const rows = await db
    .select({ id: postTags.id, name: postTags.name, aiPrompt: postTags.aiPrompt })
    .from(postTags)
    .where(and(
      eq(postTags.orgId, orgId),
      sql`${postTags.aiPrompt} IS NOT NULL AND btrim(${postTags.aiPrompt}) <> ''`,
    ));
  return rows.map((r) => ({ id: r.id, name: r.name, aiPrompt: r.aiPrompt ?? '' }));
}

async function spentTodayUsd(orgId: string): Promise<number> {
  const { rows } = await db.execute<{ usd: string | number | null }>(sql`
    SELECT coalesce(sum(cost_usd), 0) AS usd
      FROM ai_usage
     WHERE org_id = ${orgId}
       AND feature = 'post-tagging'
       AND created_at >= date_trunc('day', now())`);
  return Number(rows[0]?.usd ?? 0);
}

function dailyBudgetUsd(): number {
  const raw = Number(process.env.AI_TAGGING_DAILY_USD ?? DAILY_USD_DEFAULT);
  return Number.isFinite(raw) && raw > 0 ? raw : DAILY_USD_DEFAULT;
}

/**
 * Claim posts needing tagging for this org, newest first.
 *
 * "Needing" is one predicate: no state row, or a row whose fingerprint is not
 * the current taxonomy's, or a retryable failure whose backoff has elapsed —
 * all three under the attempts ceiling unless the fingerprint moved, which
 * re-arms everything. Claiming upserts the state row to running with a lease,
 * so overlapping ticks skip each other's work via SKIP LOCKED.
 */
async function claimPosts(
  orgId: string,
  fingerprint: string,
  limit: number,
): Promise<string[]> {
  /*
   * EXISTS rather than a join: a post whose company sits in several of the
   * org's landscapes must appear once, and GROUP BY cannot coexist with
   * FOR UPDATE. The row lock on posts is only a claim fence between
   * overlapping ticks; the durable claim is the state upsert below it.
   */
  const { rows } = await db.execute<{ post_id: string }>(sql`
    WITH candidates AS (
      SELECT p.id AS post_id
        FROM posts p
        LEFT JOIN ai_tag_state s ON s.post_id = p.id AND s.org_id = ${orgId}
       WHERE EXISTS (
               SELECT 1 FROM landscape_companies lc
               JOIN landscapes l ON l.id = lc.landscape_id
              WHERE lc.company_id = p.company_id AND l.org_id = ${orgId}
             )
         AND (
               s.post_id IS NULL
            OR (s.taxonomy_fingerprint <> ${fingerprint}
                AND (s.status <> 'running' OR s.next_attempt_at <= now()))
            OR (s.status = 'failed' AND s.attempts < ${MAX_TAGGING_ATTEMPTS}
                AND s.next_attempt_at <= now())
            OR (s.status = 'running' AND s.next_attempt_at <= now())
             )
       ORDER BY p.posted_at DESC
       LIMIT ${limit}
       FOR UPDATE OF p SKIP LOCKED
    )
    INSERT INTO ai_tag_state (org_id, post_id, taxonomy_fingerprint, status, next_attempt_at, updated_at)
    SELECT ${orgId}, c.post_id, ${fingerprint}, 'running', now() + interval '${sql.raw(String(LEASE_MINUTES))} minutes', now()
      FROM candidates c
    ON CONFLICT (org_id, post_id) DO UPDATE
       SET status = 'running',
           taxonomy_fingerprint = ${fingerprint},
           next_attempt_at = now() + interval '${sql.raw(String(LEASE_MINUTES))} minutes',
           updated_at = now()
    RETURNING post_id`);
  return rows.map((r) => r.post_id);
}

/**
 * A trusted-uuid array literal. Every id here came out of our own database a
 * moment ago; the format check is a belt on top of that, not an escape hatch
 * for user input, which must never reach this function.
 */
function uuidArray(ids: string[]): ReturnType<typeof sql.raw> {
  for (const id of ids) {
    if (!/^[0-9a-f-]{36}$/i.test(id)) throw new Error(`not a uuid: ${id}`);
  }
  return sql.raw(`'{${ids.join(',')}}'::uuid[]`);
}

async function loadPostContent(postIds: string[]): Promise<TaggablePostContent[]> {
  if (postIds.length === 0) return [];
  const { rows } = await db.execute<{
    id: string; platform: string; type: string; text: string | null;
    hashtags: unknown; urls: unknown;
  }>(sql`
    SELECT p.id, p.platform::text AS platform, p.type::text AS type, p.text,
           coalesce(p.hashtags, '[]'::jsonb) AS hashtags,
           coalesce(array_agg(u.url) FILTER (WHERE u.url IS NOT NULL), '{}') AS urls
      FROM posts p
      LEFT JOIN posted_urls u ON u.post_id = p.id
     WHERE p.id = ANY(${uuidArray(postIds)})
     GROUP BY p.id`);
  return rows.map((r) => ({
    id: r.id,
    platform: r.platform,
    type: r.type,
    text: r.text,
    hashtags: Array.isArray(r.hashtags) ? r.hashtags.filter((h): h is string => typeof h === 'string') : [],
    urls: Array.isArray(r.urls) ? r.urls.filter((u): u is string => typeof u === 'string') : [],
  }));
}

async function settle(
  orgId: string,
  postIds: string[],
  fingerprint: string,
  outcome: 'succeeded' | 'failed',
  model: string | null,
  error?: string,
): Promise<void> {
  if (postIds.length === 0) return;
  await db.execute(sql`
    UPDATE ai_tag_state s
       SET status = ${outcome},
           model = ${model},
           taxonomy_fingerprint = ${fingerprint},
           attempts = CASE WHEN ${outcome} = 'succeeded' THEN 0 ELSE s.attempts + 1 END,
           next_attempt_at = CASE WHEN ${outcome} = 'succeeded' THEN NULL
             ELSE now() + make_interval(mins => 10 * power(2, least(s.attempts, 8))::int) END,
           tagged_at = CASE WHEN ${outcome} = 'succeeded' THEN now() ELSE s.tagged_at END,
           last_error = ${error ?? null},
           updated_at = now()
     WHERE s.org_id = ${orgId} AND s.post_id = ANY(${uuidArray(postIds)})`);
}

/** One org's tick: claim → complete → validate → write → settle. */
export async function runTaggingTick(orgId: string): Promise<TagTickResult> {
  const tags = await aiTagsForOrg(orgId);
  const fingerprint = taxonomyFingerprint(tags);
  const base: TagTickResult = {
    orgId, fingerprint, claimed: 0, tagged: 0, assignmentsWritten: 0,
    droppedByValidation: 0, failed: 0, spentUsd: 0, budgetExhausted: false,
  };
  if (tags.length === 0) return { ...base, skipped: 'no AI-eligible tags' };

  const spent = await spentTodayUsd(orgId);
  if (spent >= dailyBudgetUsd()) {
    return { ...base, spentUsd: spent, budgetExhausted: true, skipped: 'daily budget reached' };
  }

  const claimed = await claimPosts(orgId, fingerprint, POSTS_PER_COMPLETION);
  base.claimed = claimed.length;
  if (claimed.length === 0) return base;

  const posts = await loadPostContent(claimed);
  const readable = posts.filter((p) => (p.text ?? '').trim() || p.hashtags.length > 0);
  const unreadable = claimed.filter((id) => !readable.some((p) => p.id === id));
  // Nothing to read is a measured result, not a failure: settle and move on.
  await settle(orgId, unreadable, fingerprint, 'succeeded', null);

  if (readable.length === 0) {
    return { ...base, tagged: unreadable.length };
  }

  try {
    const result = await complete(
      orgId,
      {
        messages: buildTaggingMessages(tags, readable),
        jsonSchema: TAGGING_SCHEMA as unknown as Record<string, unknown>,
        maxTokens: 4_000,
        temperature: 0,
      },
      { feature: 'post-tagging' },
    );
    const payload = result.json ?? safeParse(result.text);
    const { assignments, dropped } = validateAssignments(payload, tags, readable);
    base.droppedByValidation = dropped;
    base.spentUsd = result.costUsd;

    const readableIds = readable.map((p) => p.id);
    const orgTagIds = tags.map((t) => t.id);
    // 1. Clear this org's previous AI opinions on these posts. Manual and rule
    //    assignments are untouched by the source predicate.
    await db.delete(postTagAssignments).where(and(
      inArray(postTagAssignments.postId, readableIds),
      inArray(postTagAssignments.tagId, orgTagIds),
      eq(postTagAssignments.source, 'ai'),
    ));
    // 2. Write the new opinions. DO NOTHING on conflict: an existing manual or
    //    rule row for the same (post, tag) outranks the model and stays.
    if (assignments.length > 0) {
      await db.insert(postTagAssignments)
        .values(assignments.map((a) => ({
          postId: a.postId,
          tagId: a.tagId,
          source: 'ai' as const,
          confidence: a.confidence,
        })))
        .onConflictDoNothing();
      base.assignmentsWritten = assignments.length;
    }
    // 3. The cursor moves last.
    await settle(orgId, readableIds, fingerprint, 'succeeded', result.model);
    base.tagged = readableIds.length + unreadable.length;
    return base;
  } catch (err) {
    const message = err instanceof ModelError ? err.message : String(err);
    await settle(orgId, readable.map((p) => p.id), fingerprint, 'failed', null, message.slice(0, 500));
    base.failed = readable.length;
    return base;
  }
}

function safeParse(text: string): unknown {
  try {
    const fenced = /```(?:json)?\s*([\s\S]*?)```/.exec(text);
    return JSON.parse(fenced ? fenced[1] : text);
  } catch {
    return null;
  }
}
