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
import { postTagAssignments, postTags, tagSuggestions } from '@/db/schema';
import { complete } from '@/lib/ai/client';
import { ModelError } from '@/lib/ai/types';
import {
  buildTaggingMessages,
  MAX_TAGGING_ATTEMPTS,
  TAGGING_SCHEMA,
  taxonomyFingerprint,
  validateAssignments,
  validateSuggestions,
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
  const { rows } = await db.execute<{
    id: string; name: string; ai_prompt: string | null; landscape_ids: unknown;
  }>(sql`
    SELECT t.id::text AS id, t.name, t.ai_prompt,
           coalesce(json_agg(ptl.landscape_id::text) FILTER (WHERE ptl.landscape_id IS NOT NULL), '[]'::json)
             AS landscape_ids
      FROM post_tags t
      LEFT JOIN post_tag_landscapes ptl ON ptl.tag_id = t.id
     WHERE t.org_id = ${orgId}
       AND t.ai_prompt IS NOT NULL AND btrim(t.ai_prompt) <> ''
     GROUP BY t.id, t.name, t.ai_prompt`);
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    aiPrompt: r.ai_prompt ?? '',
    landscapeIds: Array.isArray(r.landscape_ids)
      ? r.landscape_ids.filter((x): x is string => typeof x === 'string')
      : [],
  }));
}

/**
 * Companies grouped by their applicable tag set.
 *
 * A tag applies to a company when the tag is unscoped, or when any of the
 * tag's landscapes contains the company. Companies sharing an identical
 * applicable set batch together under that set's fingerprint — which is what
 * makes an MLB feed and a news feed never share a prompt, and makes
 * re-scoping a tag automatically stale exactly the posts it gained or lost.
 */
export interface CompanyTagGroup {
  fingerprint: string;
  tags: AiTagDefinition[];
  companyIds: string[];
}

export async function companyTagGroups(
  orgId: string,
  tags: AiTagDefinition[],
): Promise<CompanyTagGroup[]> {
  const { rows } = await db.execute<{ company_id: string; landscape_ids: unknown }>(sql`
    SELECT lc.company_id::text AS company_id,
           json_agg(DISTINCT l.id::text) AS landscape_ids
      FROM landscape_companies lc
      JOIN landscapes l ON l.id = lc.landscape_id AND l.org_id = ${orgId}
     GROUP BY lc.company_id`);
  const groups = new Map<string, CompanyTagGroup>();
  for (const row of rows) {
    const memberOf = new Set(Array.isArray(row.landscape_ids)
      ? row.landscape_ids.filter((x): x is string => typeof x === 'string')
      : []);
    const applicable = tags.filter((t) =>
      t.landscapeIds.length === 0 || t.landscapeIds.some((id) => memberOf.has(id)));
    if (applicable.length === 0) continue;
    const fingerprint = taxonomyFingerprint(applicable);
    const group = groups.get(fingerprint)
      ?? { fingerprint, tags: applicable, companyIds: [] };
    group.companyIds.push(row.company_id);
    groups.set(fingerprint, group);
  }
  return [...groups.values()];
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
  companyIds: string[],
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
       WHERE p.company_id = ANY(${uuidArray(companyIds)})
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
  const base: TagTickResult = {
    orgId, fingerprint: '', claimed: 0, tagged: 0, assignmentsWritten: 0,
    droppedByValidation: 0, failed: 0, spentUsd: 0, budgetExhausted: false,
  };
  if (tags.length === 0) return { ...base, skipped: 'no AI-eligible tags' };

  const spent = await spentTodayUsd(orgId);
  if (spent >= dailyBudgetUsd()) {
    return { ...base, spentUsd: spent, budgetExhausted: true, skipped: 'daily budget reached' };
  }

  const groups = await companyTagGroups(orgId, tags);
  if (groups.length === 0) return { ...base, skipped: 'no companies with applicable tags' };
  for (const group of groups) {
    const groupResult = await runGroup(orgId, group);
    base.claimed += groupResult.claimed;
    base.tagged += groupResult.tagged;
    base.assignmentsWritten += groupResult.assignmentsWritten;
    base.droppedByValidation += groupResult.droppedByValidation;
    base.failed += groupResult.failed;
    base.spentUsd += groupResult.spentUsd;
    if (base.spentUsd + spent >= dailyBudgetUsd()) { base.budgetExhausted = true; break; }
  }
  return base;
}

interface GroupResult {
  claimed: number; tagged: number; assignmentsWritten: number;
  droppedByValidation: number; failed: number; spentUsd: number;
}

/** One completion for one company group's applicable taxonomy. */
async function runGroup(orgId: string, group: CompanyTagGroup): Promise<GroupResult> {
  const { fingerprint, tags } = group;
  const result: GroupResult = {
    claimed: 0, tagged: 0, assignmentsWritten: 0,
    droppedByValidation: 0, failed: 0, spentUsd: 0,
  };
  const claimed = await claimPosts(orgId, fingerprint, group.companyIds, POSTS_PER_COMPLETION);
  result.claimed = claimed.length;
  if (claimed.length === 0) return result;

  const posts = await loadPostContent(claimed);
  const readable = posts.filter((p) => (p.text ?? '').trim() || p.hashtags.length > 0);
  const unreadable = claimed.filter((id) => !readable.some((p) => p.id === id));
  // Nothing to read is a measured result, not a failure: settle and move on.
  await settle(orgId, unreadable, fingerprint, 'succeeded', null);
  result.tagged += unreadable.length;

  if (readable.length === 0) return result;

  try {
    const completion = await complete(
      orgId,
      {
        messages: buildTaggingMessages(tags, readable),
        jsonSchema: TAGGING_SCHEMA as unknown as Record<string, unknown>,
        maxTokens: 4_000,
        temperature: 0,
      },
      { feature: 'post-tagging' },
    );
    const payload = completion.json ?? safeParse(completion.text);
    const { assignments, dropped } = validateAssignments(payload, tags, readable);
    result.droppedByValidation = dropped;
    result.spentUsd = completion.costUsd;

    const readableIds = readable.map((p) => p.id);
    // Clear only THIS group's tags: an assignment from a tag scoped to some
    // other landscape set is a different taxonomy's opinion and stays.
    const groupTagIds = tags.map((t) => t.id);
    // 1. Clear previous AI opinions for these posts within this taxonomy.
    //    Manual and rule assignments are untouched by the source predicate.
    await db.delete(postTagAssignments).where(and(
      inArray(postTagAssignments.postId, readableIds),
      inArray(postTagAssignments.tagId, groupTagIds),
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
      result.assignmentsWritten = assignments.length;
    }
    // 2b. Bank what the model wished it could say. Suggestions are evidence
    //     for the curator, never assignments; the PK makes a re-run of this
    //     batch (crash before settle) idempotent.
    const suggestions = validateSuggestions(payload, tags, readable);
    if (suggestions.length > 0) {
      await db.insert(tagSuggestions)
        .values(suggestions.map((s) => ({
          orgId,
          postId: s.postId,
          label: s.label,
          labelNorm: s.labelNorm,
        })))
        .onConflictDoNothing();
    }
    // 3. The cursor moves last.
    await settle(orgId, readableIds, fingerprint, 'succeeded', completion.model);
    result.tagged += readableIds.length;
    return result;
  } catch (err) {
    const message = err instanceof ModelError ? err.message : String(err);
    await settle(orgId, readable.map((p) => p.id), fingerprint, 'failed', null, message.slice(0, 500));
    result.failed = readable.length;
    return result;
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
