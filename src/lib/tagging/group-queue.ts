/**
 * Tagging for group posts.
 *
 * This is the brand tagger's twin, not a second opinion. It calls the same
 * `buildTaggingMessages`, the same `TAGGING_SCHEMA` and the same
 * `validateAssignments` against the same `post_tags` taxonomy, so "Housing" on
 * a Somerville group post means what "Housing" means on a Globe post. Only the
 * persistence differs, because group posts cannot live in tables keyed to
 * `posts`.
 *
 * Two real differences from the brand path:
 *  - No landscape scoping. A group post has no company, so every AI-eligible
 *    tag in the org applies and there is one fingerprint per org.
 *  - Suggestions are not banked. The curator's evidence comes from brand posts,
 *    where the taxonomy is scoped and the signal is cleaner.
 */
import { and, eq, inArray, sql } from 'drizzle-orm';
import { db } from '@/db';
import { groupPostTagAssignments } from '@/db/schema';
import { complete } from '@/lib/ai/client';
import { ModelError } from '@/lib/ai/types';
import {
  buildTaggingMessages,
  MAX_TAGGING_ATTEMPTS,
  TAGGING_SCHEMA,
  taxonomyFingerprint,
  validateAssignments,
  type TaggablePostContent,
} from './ai-tagger';
import { aiTagsForOrg, isBillingFailure } from './queue';

const POSTS_PER_COMPLETION = 20;
const LEASE_MINUTES = 10;
const DAILY_USD_DEFAULT = 5;

export interface GroupTagTickResult {
  orgId: string;
  claimed: number;
  tagged: number;
  assignmentsWritten: number;
  failed: number;
  spentUsd: number;
  budgetExhausted: boolean;
  skipped?: string;
}

function dailyBudgetUsd(): number {
  const raw = Number(process.env.AI_TAGGING_DAILY_USD ?? DAILY_USD_DEFAULT);
  return Number.isFinite(raw) && raw > 0 ? raw : DAILY_USD_DEFAULT;
}

async function spentTodayUsd(orgId: string): Promise<number> {
  const { rows } = await db.execute<{ usd: string | number | null }>(sql`
    SELECT coalesce(sum(cost_usd), 0) AS usd
      FROM ai_usage
     WHERE org_id = ${orgId} AND feature = 'post-tagging'
       AND created_at >= date_trunc('day', now())`);
  return Number(rows[0]?.usd ?? 0);
}

function uuidArray(ids: string[]): ReturnType<typeof sql.raw> {
  for (const id of ids) {
    if (!/^[0-9a-f-]{36}$/i.test(id)) throw new Error(`not a uuid: ${id}`);
  }
  return sql.raw(`'{${ids.join(',')}}'::uuid[]`);
}

/** Claim group posts needing tagging, newest first, under a lease. */
async function claimPosts(orgId: string, fingerprint: string, limit: number): Promise<string[]> {
  const { rows } = await db.execute<{ group_post_id: string }>(sql`
    WITH candidates AS (
      SELECT gp.id AS group_post_id
        FROM group_posts gp
        LEFT JOIN group_tag_state s
          ON s.group_post_id = gp.id AND s.org_id = ${orgId}
       WHERE gp.org_id = ${orgId}
         AND coalesce(btrim(gp.content), '') <> ''
         AND (
               s.group_post_id IS NULL
            OR (s.taxonomy_fingerprint <> ${fingerprint}
                AND (s.status <> 'running' OR s.next_attempt_at <= now()))
            OR (s.status = 'failed' AND s.attempts < ${MAX_TAGGING_ATTEMPTS}
                AND s.next_attempt_at <= now())
            OR (s.status = 'running' AND s.next_attempt_at <= now())
             )
       ORDER BY gp.posted_at DESC NULLS LAST
       LIMIT ${limit}
       FOR UPDATE OF gp SKIP LOCKED
    )
    INSERT INTO group_tag_state (org_id, group_post_id, taxonomy_fingerprint, status, next_attempt_at, updated_at)
    SELECT ${orgId}, c.group_post_id, ${fingerprint}, 'running',
           now() + interval '${sql.raw(String(LEASE_MINUTES))} minutes', now()
      FROM candidates c
    ON CONFLICT (org_id, group_post_id) DO UPDATE
       SET status = 'running',
           taxonomy_fingerprint = ${fingerprint},
           next_attempt_at = now() + interval '${sql.raw(String(LEASE_MINUTES))} minutes',
           updated_at = now()
    RETURNING group_post_id`);
  return rows.map((r) => r.group_post_id);
}

async function loadContent(ids: string[]): Promise<TaggablePostContent[]> {
  if (ids.length === 0) return [];
  const { rows } = await db.execute<{ id: string; content: string | null; urls: unknown }>(sql`
    SELECT gp.id, gp.content, gp.urls
      FROM group_posts gp
     WHERE gp.id = ANY(${uuidArray(ids)})`);
  return rows.map((r) => ({
    id: r.id,
    // Group posts are Facebook text posts; the shape the tagger expects.
    platform: 'facebook',
    type: 'post',
    text: r.content,
    hashtags: [],
    urls: Array.isArray(r.urls)
      ? r.urls
        .map((u) => (u && typeof u === 'object' && 'url' in u ? String((u as { url: unknown }).url) : ''))
        .filter(Boolean)
      : [],
  }));
}

async function settle(
  orgId: string,
  ids: string[],
  fingerprint: string,
  outcome: 'succeeded' | 'failed',
  model: string | null,
  error?: string,
): Promise<void> {
  if (ids.length === 0) return;
  // Same rule as the brand queue: running out of credits is a pause, not a
  // strike, so it must not consume the retries that exist for bad requests.
  const billing = outcome === 'failed' && !!error && isBillingFailure(error);
  await db.execute(sql`
    UPDATE group_tag_state s
       SET status = ${outcome},
           model = ${model},
           taxonomy_fingerprint = ${fingerprint},
           attempts = CASE
             WHEN ${outcome} = 'succeeded' THEN 0
             WHEN ${billing} THEN s.attempts
             ELSE s.attempts + 1 END,
           next_attempt_at = CASE
             WHEN ${outcome} = 'succeeded' THEN NULL
             WHEN ${billing} THEN now() + interval '1 hour'
             ELSE now() + make_interval(mins => 10 * power(2, least(s.attempts, 8))::int) END,
           tagged_at = CASE WHEN ${outcome} = 'succeeded' THEN now() ELSE s.tagged_at END,
           last_error = ${error ?? null},
           updated_at = now()
     WHERE s.org_id = ${orgId} AND s.group_post_id = ANY(${uuidArray(ids)})`);
}

function safeParse(text: string): unknown {
  try {
    const fenced = /```(?:json)?\s*([\s\S]*?)```/.exec(text);
    return JSON.parse(fenced ? fenced[1] : text);
  } catch {
    return null;
  }
}

/** One org's group-tagging tick: claim → complete → validate → write → settle. */
export async function runGroupTaggingTick(orgId: string): Promise<GroupTagTickResult> {
  const base: GroupTagTickResult = {
    orgId, claimed: 0, tagged: 0, assignmentsWritten: 0,
    failed: 0, spentUsd: 0, budgetExhausted: false,
  };
  const tags = await aiTagsForOrg(orgId);
  if (tags.length === 0) return { ...base, skipped: 'no AI-eligible tags' };

  const spent = await spentTodayUsd(orgId);
  if (spent >= dailyBudgetUsd()) {
    return { ...base, spentUsd: spent, budgetExhausted: true, skipped: 'daily budget reached' };
  }

  const fingerprint = taxonomyFingerprint(tags);
  const claimed = await claimPosts(orgId, fingerprint, POSTS_PER_COMPLETION);
  base.claimed = claimed.length;
  if (claimed.length === 0) return base;

  const posts = await loadContent(claimed);
  const readable = posts.filter((p) => (p.text ?? '').trim());
  const unreadable = claimed.filter((id) => !readable.some((p) => p.id === id));
  await settle(orgId, unreadable, fingerprint, 'succeeded', null);
  base.tagged += unreadable.length;
  if (readable.length === 0) return base;

  try {
    const completion = await complete(
      orgId,
      {
        messages: buildTaggingMessages(tags, readable),
        jsonSchema: TAGGING_SCHEMA as unknown as Record<string, unknown>,
        maxTokens: 10_000,
        temperature: 0,
      },
      { feature: 'post-tagging' },
    );
    const payload = completion.json ?? safeParse(completion.text);
    const { assignments } = validateAssignments(payload, tags, readable);
    base.spentUsd = completion.costUsd;

    const ids = readable.map((p) => p.id);
    await db.delete(groupPostTagAssignments).where(and(
      inArray(groupPostTagAssignments.groupPostId, ids),
      eq(groupPostTagAssignments.source, 'ai'),
    ));
    if (assignments.length > 0) {
      await db.insert(groupPostTagAssignments)
        .values(assignments.map((a) => ({
          groupPostId: a.postId,
          tagId: a.tagId,
          source: 'ai' as const,
          confidence: a.confidence,
        })))
        .onConflictDoNothing();
      base.assignmentsWritten = assignments.length;
    }
    await settle(orgId, ids, fingerprint, 'succeeded', completion.model);
    base.tagged += ids.length;
    return base;
  } catch (err) {
    const message = err instanceof ModelError ? err.message : String(err);
    await settle(orgId, readable.map((p) => p.id), fingerprint, 'failed', null, message.slice(0, 500));
    base.failed = readable.length;
    return base;
  }
}
