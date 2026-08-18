/**
 * The curator: durable half. Gather evidence → one completion → execute
 * verdicts → audit everything.
 *
 * Runs at the tail of the tag cron tick, under its own small daily budget
 * (`AI_TAG_CURATION_DAILY_USD`, default 1) and its own creation cap
 * (`AI_TAG_AUTOCREATE_DAILY`, default 3). `AI_TAG_CURATION_MODE=queue` turns
 * every "create" into a queued proposal awaiting the operator instead — the
 * dial between automation and approval is an env var, not a rewrite.
 *
 * Verdict execution notes:
 * - covered/rejected: the label's open suggestions resolve; a proposal row
 *   records the ruling. A label ruled in the last 14 days is not re-gathered,
 *   so the curator does not re-litigate its own decisions every pass.
 * - create: the tag is born with the curator's definition as its aiPrompt and
 *   scoped to its parent's landscapes (or, with no parent, to the landscapes
 *   the evidence actually came from — never silently org-wide). Its creation
 *   moves the taxonomy fingerprint, and the existing recompute wave applies
 *   it retroactively. No assignments are written here; the one write path for
 *   assignments stays the tagger.
 */
import { sql } from 'drizzle-orm';
import { db } from '@/db';
import { postTagLandscapes, postTags, tagProposals } from '@/db/schema';
import { complete } from '@/lib/ai/client';
import type { AiTagDefinition } from './ai-tagger';
import { aiTagsForOrg } from './queue';
import {
  AUTOCREATE_DAILY_DEFAULT,
  buildCurationMessages,
  CURATION_SCHEMA,
  GROUPS_PER_PASS,
  MIN_SUPPORT_COMPANIES,
  MIN_SUPPORT_POSTS,
  autoTagColor,
  validateVerdicts,
  type CuratorVerdict,
  type SuggestionGroup,
} from './curator';

const CURATOR_MODEL_DEFAULT = 'anthropic/claude-sonnet-5';
const CURATION_USD_DEFAULT = 1;
/** Days a ruling suppresses re-gathering of the same label. */
const RULING_MEMORY_DAYS = 14;
const SAMPLES_PER_GROUP = 8;
const SAMPLE_CHARS = 240;

export interface CurationPassResult {
  orgId: string;
  groups: number;
  covered: number;
  created: number;
  rejected: number;
  queued: number;
  spentUsd: number;
  skipped?: string;
}

function curationMode(): 'auto' | 'queue' {
  return process.env.AI_TAG_CURATION_MODE === 'queue' ? 'queue' : 'auto';
}

function curatorModel(): string {
  return process.env.AI_TAG_CURATOR_MODEL || CURATOR_MODEL_DEFAULT;
}

function autocreateDaily(): number {
  const raw = Number(process.env.AI_TAG_AUTOCREATE_DAILY ?? AUTOCREATE_DAILY_DEFAULT);
  return Number.isFinite(raw) && raw >= 0 ? Math.trunc(raw) : AUTOCREATE_DAILY_DEFAULT;
}

function curationBudgetUsd(): number {
  const raw = Number(process.env.AI_TAG_CURATION_DAILY_USD ?? CURATION_USD_DEFAULT);
  return Number.isFinite(raw) && raw > 0 ? raw : CURATION_USD_DEFAULT;
}

async function curationSpentTodayUsd(orgId: string): Promise<number> {
  const { rows } = await db.execute<{ usd: string | number | null }>(sql`
    SELECT coalesce(sum(cost_usd), 0) AS usd
      FROM ai_usage
     WHERE org_id = ${orgId} AND feature = 'tag-curation'
       AND created_at >= date_trunc('day', now())`);
  return Number(rows[0]?.usd ?? 0);
}

async function createdTodayCount(orgId: string): Promise<number> {
  const { rows } = await db.execute<{ n: string | number }>(sql`
    SELECT count(*) AS n FROM tag_proposals
     WHERE org_id = ${orgId} AND verdict = 'created'
       AND created_at >= date_trunc('day', now())`);
  return Number(rows[0]?.n ?? 0);
}

/** Open suggestion groups with enough support, minus recently ruled labels. */
async function gatherGroups(orgId: string): Promise<SuggestionGroup[]> {
  const { rows } = await db.execute<{
    label_norm: string; label: string;
    support_posts: string | number; support_companies: string | number;
  }>(sql`
    SELECT s.label_norm,
           mode() WITHIN GROUP (ORDER BY s.label) AS label,
           count(DISTINCT s.post_id) AS support_posts,
           count(DISTINCT p.company_id) AS support_companies
      FROM tag_suggestions s
      JOIN posts p ON p.id = s.post_id
     WHERE s.org_id = ${orgId} AND s.status = 'open'
       AND NOT EXISTS (
         SELECT 1 FROM tag_proposals pr
          WHERE pr.org_id = s.org_id AND pr.label_norm = s.label_norm
            AND pr.created_at > now() - make_interval(days => ${RULING_MEMORY_DAYS}))
     GROUP BY s.label_norm
    HAVING count(DISTINCT s.post_id) >= ${MIN_SUPPORT_POSTS}
       AND count(DISTINCT p.company_id) >= ${MIN_SUPPORT_COMPANIES}
     ORDER BY count(DISTINCT s.post_id) DESC
     LIMIT ${GROUPS_PER_PASS}`);

  const groups: SuggestionGroup[] = [];
  for (const row of rows) {
    const { rows: samples } = await db.execute<{ company: string; text: string }>(sql`
      SELECT co.name AS company, left(coalesce(p.text, ''), ${SAMPLE_CHARS}) AS text
        FROM tag_suggestions s
        JOIN posts p ON p.id = s.post_id
        JOIN companies co ON co.id = p.company_id
       WHERE s.org_id = ${orgId} AND s.label_norm = ${row.label_norm} AND s.status = 'open'
       ORDER BY p.posted_at DESC
       LIMIT ${SAMPLES_PER_GROUP}`);
    groups.push({
      labelNorm: row.label_norm,
      label: row.label,
      supportPosts: Number(row.support_posts),
      supportCompanies: Number(row.support_companies),
      samples: samples.map((s) => ({ company: s.company, text: s.text })),
    });
  }
  return groups;
}

async function resolveSuggestions(
  orgId: string,
  labelNorm: string,
  resolution: 'covered' | 'created' | 'rejected',
  tagId: string | null,
): Promise<void> {
  await db.execute(sql`
    UPDATE tag_suggestions
       SET status = 'resolved', resolution = ${resolution},
           resolved_tag_id = ${tagId}, resolved_at = now()
     WHERE org_id = ${orgId} AND label_norm = ${labelNorm} AND status = 'open'`);
}

/** Landscapes for a new tag: the parent's scope, else where the evidence lives. */
async function scopeForNewTag(
  orgId: string,
  parentTagId: string | null,
  labelNorm: string,
): Promise<string[]> {
  if (parentTagId) {
    const { rows } = await db.execute<{ landscape_id: string }>(sql`
      SELECT landscape_id::text FROM post_tag_landscapes WHERE tag_id = ${parentTagId}`);
    if (rows.length > 0) return rows.map((r) => r.landscape_id);
  }
  const { rows } = await db.execute<{ landscape_id: string }>(sql`
    SELECT DISTINCT lc.landscape_id::text
      FROM tag_suggestions s
      JOIN posts p ON p.id = s.post_id
      JOIN landscape_companies lc ON lc.company_id = p.company_id
      JOIN landscapes l ON l.id = lc.landscape_id AND l.org_id = ${orgId}
     WHERE s.org_id = ${orgId} AND s.label_norm = ${labelNorm}`);
  return rows.map((r) => r.landscape_id);
}

async function executeVerdict(
  orgId: string,
  verdict: CuratorVerdict,
  group: SuggestionGroup,
  allowCreate: boolean,
): Promise<'covered' | 'created' | 'rejected' | 'queued'> {
  const evidence = {
    supportPosts: group.supportPosts,
    supportCompanies: group.supportCompanies,
    samples: group.samples.slice(0, 3),
  };
  const base = {
    orgId,
    labelNorm: verdict.labelNorm,
    confidence: verdict.confidence,
    rationale: verdict.rationale,
    supportPosts: group.supportPosts,
    supportCompanies: group.supportCompanies,
    evidence,
    decidedAt: new Date(),
  };

  if (verdict.verdict === 'covered') {
    await db.insert(tagProposals).values({
      ...base, verdict: 'covered', coveredByTagId: verdict.coveredByTagId,
    });
    await resolveSuggestions(orgId, verdict.labelNorm, 'covered', verdict.coveredByTagId);
    return 'covered';
  }

  if (verdict.verdict === 'reject') {
    await db.insert(tagProposals).values({ ...base, verdict: 'rejected' });
    await resolveSuggestions(orgId, verdict.labelNorm, 'rejected', null);
    return 'rejected';
  }

  // create
  if (!allowCreate) {
    // Queued proposals keep their suggestions open; the 14-day ruling memory
    // stops re-litigating while the proposal waits for the operator (or for
    // tomorrow's creation budget).
    await db.insert(tagProposals).values({
      ...base, verdict: 'queued',
      name: verdict.name, definition: verdict.definition, parentTagId: verdict.parentTagId,
    });
    return 'queued';
  }

  const [tag] = await db.insert(postTags).values({
    orgId,
    name: verdict.name!,
    color: autoTagColor(verdict.name!),
    aiPrompt: verdict.definition!,
  }).returning({ id: postTags.id });

  const scope = await scopeForNewTag(orgId, verdict.parentTagId, verdict.labelNorm);
  if (scope.length > 0) {
    await db.insert(postTagLandscapes)
      .values(scope.map((landscapeId) => ({ tagId: tag.id, landscapeId })))
      .onConflictDoNothing();
  }

  await db.insert(tagProposals).values({
    ...base, verdict: 'created',
    name: verdict.name, definition: verdict.definition, parentTagId: verdict.parentTagId,
    createdTagId: tag.id,
  });
  await resolveSuggestions(orgId, verdict.labelNorm, 'created', tag.id);
  return 'created';
}

/** One org's curation pass. Cheap when there is nothing to do. */
export async function runCurationPass(orgId: string): Promise<CurationPassResult> {
  const base: CurationPassResult = {
    orgId, groups: 0, covered: 0, created: 0, rejected: 0, queued: 0, spentUsd: 0,
  };

  const spent = await curationSpentTodayUsd(orgId);
  if (spent >= curationBudgetUsd()) return { ...base, skipped: 'curation budget reached' };

  const groups = await gatherGroups(orgId);
  if (groups.length === 0) return { ...base, skipped: 'no groups above support threshold' };
  base.groups = groups.length;

  const tags: AiTagDefinition[] = await aiTagsForOrg(orgId);
  if (tags.length === 0) return { ...base, skipped: 'no taxonomy to govern' };

  const completion = await complete(
    orgId,
    {
      messages: buildCurationMessages(tags, groups),
      jsonSchema: CURATION_SCHEMA as unknown as Record<string, unknown>,
      maxTokens: 4_000,
      temperature: 0,
      model: curatorModel(),
    },
    { feature: 'tag-curation' },
  );
  base.spentUsd = completion.costUsd;

  const verdicts = validateVerdicts(
    completion.json ?? safeParse(completion.text), tags, groups,
  );

  const mode = curationMode();
  let createsLeft = mode === 'queue'
    ? 0
    : Math.max(0, autocreateDaily() - await createdTodayCount(orgId));

  for (const verdict of verdicts) {
    const group = groups.find((g) => g.labelNorm === verdict.labelNorm);
    if (!group) continue;
    const allowCreate = verdict.verdict === 'create' && createsLeft > 0;
    const outcome = await executeVerdict(orgId, verdict, group, allowCreate);
    if (outcome === 'created') createsLeft -= 1;
    base[outcome] += 1;
  }
  return base;
}

function safeParse(text: string): unknown {
  try {
    const fenced = /```(?:json)?\s*([\s\S]*?)```/.exec(text);
    return JSON.parse(fenced ? fenced[1] : text);
  } catch {
    return null;
  }
}
