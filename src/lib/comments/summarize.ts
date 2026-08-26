/**
 * Comment-section summaries: one glanceable paragraph per commented post.
 *
 * A hundred comments is evidence nobody has time to read, and the whole point
 * of buying them is that the newsroom should not have to. The model reads the
 * collected section and writes two or three sentences on what commenters are
 * saying, which the post dialog shows above the raw sample.
 *
 * Same shape as the story-narrative job, which earned its scars already: a
 * bounded tick with a time budget and a daily spend budget, candidates found
 * by absence (no summary row = work to do), a strict JSON schema, and a
 * validator that would rather write nothing than write something broken.
 */
import { sql } from 'drizzle-orm';
import { db } from '@/db';
import { complete } from '@/lib/ai/client';
import { orgsWithAiTags } from '@/lib/tagging/queue';
import { readControl } from '@/lib/controls';

export const COMMENT_SUMMARY_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['summary'],
  properties: {
    summary: { type: 'string' },
  },
} as const;

/** Comments sent per summary: the head of the section, by audience agreement. */
export const MAX_COMMENTS_PER_SUMMARY = 80;
const MAX_COMMENT_CHARS = 240;
/** A section this thin is readable at a glance already; silence beats padding. */
export const MIN_COMMENTS_FOR_SUMMARY = 5;

const TICK_MS_BUDGET = 120_000;

function dailyBudgetUsd(): number {
  const raw = Number(process.env.COMMENT_SUMMARY_DAILY_USD ?? 1);
  return Number.isFinite(raw) && raw > 0 ? raw : 1;
}

export interface CommentForSummary {
  text: string;
  likes: number;
}

export function buildCommentSummaryMessages(req: {
  company: string;
  postText: string;
  comments: CommentForSummary[];
}): { role: 'system' | 'user'; content: string }[] {
  const system = [
    'You summarize the comment section under one social media post, for a newsroom',
    'analytics tool. Newsroom staff glance at your summary instead of reading the',
    'section.',
    '',
    'You will be given the post and its most-liked comments, ordered by likes. Likes',
    'mean audience agreement, so the top of the list is what the audience endorsed,',
    'not just what one person typed. Write TWO or THREE sentences describing what',
    'commenters are saying.',
    '',
    'Rules:',
    '1. Describe only what the comments actually say. No background from your own',
    '   knowledge, no fact-checking, no speculation about who the commenters are.',
    '2. Lead with the dominant sentiment or theme and say roughly how dominant it is',
    '   in plain words ("most", "a sizable minority", "a few"). Name real minority',
    '   themes; skip one-off stray remarks.',
    '3. Report hostile, conspiratorial, or accusatory themes plainly as claims made',
    '   by commenters, in indirect speech. Never adopt a claim as fact, and never',
    '   soften that commenters are making it.',
    '4. Plain language, present tense, no preamble, no "the comment section". Start',
    '   with the substance.',
    '',
    'Return JSON matching the schema exactly.',
  ].join('\n');

  const lines = req.comments
    .slice(0, MAX_COMMENTS_PER_SUMMARY)
    .map((c) => `[${c.likes} likes] ${c.text.slice(0, MAX_COMMENT_CHARS)}`);

  const user = [
    `The post, from ${req.company}:`,
    req.postText.slice(0, 500) || '(no caption captured)',
    '',
    `The ${lines.length} most-liked comments:`,
    ...lines,
  ].join('\n');

  return [
    { role: 'system', content: system },
    { role: 'user', content: user },
  ];
}

/** Accepts a summary only when it is a plausible glanceable paragraph. */
export function validateCommentSummary(value: unknown): string | null {
  if (typeof value !== 'object' || value === null) return null;
  const summary = (value as Record<string, unknown>).summary;
  if (typeof summary !== 'string') return null;
  const text = summary.trim();
  if (text.length < 40 || text.length > 700) return null;
  return text;
}

export interface CommentSummaryTickResult {
  candidates: number;
  written: number;
  rejected: number;
  spentUsd: number;
  skipped?: string;
}

async function spentTodayUsd(orgId: string): Promise<number> {
  const { rows } = await db.execute<{ usd: string | number | null }>(sql`
    SELECT coalesce(sum(cost_usd), 0) AS usd
      FROM ai_usage
     WHERE org_id = ${orgId} AND feature = 'comment-summary'
       AND created_at > date_trunc('day', now())`);
  return Number(rows[0]?.usd ?? 0);
}

/** One tick: summarize up to the operator-controlled number of posts. */
export async function runCommentSummaryTick(): Promise<CommentSummaryTickResult> {
  const base: CommentSummaryTickResult = { candidates: 0, written: 0, rejected: 0, spentUsd: 0 };

  const controls = await readControl('summaries');
  if (!controls.enabled) return { ...base, skipped: 'switched off by operator control' };

  // Comments are pooled; the completion still needs an org's model connection
  // and budget. The org running the tagging reader is the natural payer, and
  // in practice there is one.
  const orgIds = await orgsWithAiTags();
  const orgId = orgIds[0];
  if (!orgId) return { ...base, skipped: 'no org with an AI model connection' };

  const spent = await spentTodayUsd(orgId);
  if (spent >= dailyBudgetUsd()) return { ...base, skipped: 'comment summary budget reached' };

  const { rows: candidates } = await db.execute<{
    post_id: string; company: string; post_text: string | null; comment_count: string | number;
  }>(sql`
    SELECT p.id::text AS post_id, co.name AS company, p.text AS post_text,
           count(pc.id) AS comment_count
      FROM posts p
      JOIN companies co ON co.id = p.company_id
      JOIN post_comments pc ON pc.post_id = p.id
      LEFT JOIN comment_summaries s ON s.post_id = p.id
     WHERE s.post_id IS NULL
     GROUP BY p.id, co.name, p.text
    HAVING count(pc.id) >= ${MIN_COMMENTS_FOR_SUMMARY}
     ORDER BY count(pc.id) DESC
     LIMIT ${controls.postsPerTick}`);
  base.candidates = candidates.length;
  if (candidates.length === 0) return { ...base, skipped: 'nothing to summarize' };

  let spentThisTick = 0;
  const startedAt = Date.now();
  for (const candidate of candidates) {
    if (spent + spentThisTick >= dailyBudgetUsd()) {
      base.skipped = 'comment summary budget reached mid-tick';
      break;
    }
    if (Date.now() - startedAt > TICK_MS_BUDGET) {
      base.skipped = 'tick time budget reached';
      break;
    }
    const { rows: comments } = await db.execute<{ text: string; likes: number }>(sql`
      SELECT pc.text, pc.likes
        FROM post_comments pc
       WHERE pc.post_id = ${candidate.post_id}::uuid
         AND coalesce(btrim(pc.text), '') <> ''
       ORDER BY pc.likes DESC, pc.commented_at DESC NULLS LAST
       LIMIT ${MAX_COMMENTS_PER_SUMMARY}`);
    if (comments.length < MIN_COMMENTS_FOR_SUMMARY) {
      // Enough rows but not enough with text; a summary of blanks helps nobody.
      await db.execute(sql`
        INSERT INTO comment_summaries (post_id, summary, comments_considered, model, generated_at)
        VALUES (${candidate.post_id}::uuid, NULL, ${comments.length}, NULL, now())
        ON CONFLICT (post_id) DO NOTHING`);
      continue;
    }

    try {
      const completion = await complete(
        orgId,
        {
          messages: buildCommentSummaryMessages({
            company: candidate.company,
            postText: candidate.post_text ?? '',
            comments,
          }),
          jsonSchema: COMMENT_SUMMARY_SCHEMA as unknown as Record<string, unknown>,
          maxTokens: 400,
          temperature: 0.2,
        },
        { feature: 'comment-summary' },
      );
      spentThisTick += completion.costUsd;

      const text = validateCommentSummary(completion.json ?? safeParse(completion.text));
      if (!text) { base.rejected += 1; continue; }

      await db.execute(sql`
        INSERT INTO comment_summaries (post_id, summary, comments_considered, model, generated_at)
        VALUES (${candidate.post_id}::uuid, ${text}, ${comments.length}, ${completion.model}, now())
        ON CONFLICT (post_id) DO UPDATE
          SET summary = excluded.summary,
              comments_considered = excluded.comments_considered,
              model = excluded.model,
              generated_at = now()`);
      base.written += 1;
    } catch {
      // A failed post is retried on the next tick by the same selection rule.
      base.rejected += 1;
    }
  }

  base.spentUsd = spentThisTick;
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
