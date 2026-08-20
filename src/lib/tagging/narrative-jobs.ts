/**
 * Writing the day narratives: choose, read, write, store.
 *
 * Runs on its own cron (/api/cron/narrate) behind its own budget, so a deep
 * backlog can never starve tagging. The selection rule is the whole
 * design: narrate the days a reader will actually hover, newest and biggest
 * first, and never re-narrate a day whose posts have not changed.
 *
 * A day is eligible when it has at least MIN_POSTS_FOR_NARRATIVE posts for the
 * tag. It is re-narrated when its engagement has moved materially since the
 * narrative was written, which is how a day that was still accruing gets a
 * second, better reading once it settles — and why `engagement_at_write` is
 * stored alongside the text.
 */
import { sql } from 'drizzle-orm';
import { db } from '@/db';
import { complete } from '@/lib/ai/client';
import {
  buildNarrativeMessages,
  validateNarrative,
  MAX_POSTS_PER_NARRATIVE,
  MIN_POSTS_FOR_NARRATIVE,
  NARRATIVE_SCHEMA,
  type NarrativePost,
} from './narrative';

/**
 * Days narrated per tick, bounded by wall clock rather than by count.
 *
 * Each day is one completion of a few seconds, and the cron has five minutes,
 * so the useful limit is time, not a guessed number. The ceiling stops a
 * pathological run; TICK_MS_BUDGET is what actually ends a tick, leaving room
 * for the response to be written before the platform's own timeout.
 */
const DAYS_PER_TICK = 60;
const TICK_MS_BUDGET = 240_000;
/** How far back to bother narrating. */
const LOOKBACK_DAYS = 30;
/** Re-narrate when a day's engagement has moved by more than this share. */
const RESTALE_RATIO = 0.35;
const DAILY_USD_DEFAULT = 2;

export interface NarrativeTickResult {
  orgId: string;
  candidates: number;
  written: number;
  rejected: number;
  spentUsd: number;
  skipped?: string;
}

function dailyBudgetUsd(): number {
  const raw = Number(process.env.AI_NARRATIVE_DAILY_USD ?? DAILY_USD_DEFAULT);
  return Number.isFinite(raw) && raw > 0 ? raw : DAILY_USD_DEFAULT;
}

async function spentTodayUsd(orgId: string): Promise<number> {
  const { rows } = await db.execute<{ usd: string | number | null }>(sql`
    SELECT coalesce(sum(cost_usd), 0) AS usd
      FROM ai_usage
     WHERE org_id = ${orgId} AND feature = 'story-narrative'
       AND created_at >= date_trunc('day', now())`);
  return Number(rows[0]?.usd ?? 0);
}

interface Candidate {
  tagId: string;
  tagName: string;
  tagDefinition: string;
  bucket: string;
  posts: number;
  engagement: number;
}

/**
 * Days worth narrating, most recent and most engaged first.
 *
 * Restricted to AI-eligible tags because a tag with no definition has no story
 * to explain, and the definition is what tells the model what the arc IS.
 */
async function candidates(orgId: string): Promise<Candidate[]> {
  const { rows } = await db.execute<{
    tag_id: string; tag_name: string; ai_prompt: string;
    bucket: string; posts: string | number; engagement: string | number;
  }>(sql`
    WITH day_totals AS (
      SELECT t.id AS tag_id, t.name AS tag_name, t.ai_prompt,
             (p.posted_at AT TIME ZONE 'America/New_York')::date AS bucket,
             count(DISTINCT p.id) AS posts,
             coalesce(sum(p.engagement_total), 0) AS engagement
        FROM posts p
        JOIN post_tag_assignments a ON a.post_id = p.id
        JOIN post_tags t ON t.id = a.tag_id
         AND t.org_id = ${orgId}
         AND t.ai_prompt IS NOT NULL AND btrim(t.ai_prompt) <> ''
       WHERE p.posted_at >= now() - make_interval(days => ${LOOKBACK_DAYS})
       GROUP BY t.id, t.name, t.ai_prompt, 4
      HAVING count(DISTINCT p.id) >= ${MIN_POSTS_FOR_NARRATIVE}
    )
    SELECT d.tag_id::text, d.tag_name, d.ai_prompt, d.bucket::text AS bucket,
           d.posts, d.engagement
      FROM day_totals d
      LEFT JOIN story_narratives n
        ON n.org_id = ${orgId} AND n.tag_id = d.tag_id
       AND n.bucket_date = d.bucket AND n.granularity = 'day'
     WHERE n.tag_id IS NULL
        OR abs(d.engagement - n.engagement_at_write)
             > greatest(n.engagement_at_write, 1) * ${RESTALE_RATIO}
     ORDER BY d.bucket DESC, d.engagement DESC
     LIMIT ${DAYS_PER_TICK}`);

  return rows.map((r) => ({
    tagId: r.tag_id,
    tagName: r.tag_name,
    tagDefinition: r.ai_prompt,
    bucket: r.bucket,
    posts: Number(r.posts),
    engagement: Number(r.engagement),
  }));
}

/** Every post carrying the tag that day, biggest first. */
async function postsForDay(orgId: string, tagId: string, bucket: string): Promise<NarrativePost[]> {
  const { rows } = await db.execute<{
    company: string; platform: string; text: string | null;
  }>(sql`
    SELECT co.name AS company, p.platform::text AS platform, p.text
      FROM posts p
      JOIN post_tag_assignments a ON a.post_id = p.id
      JOIN post_tags t ON t.id = a.tag_id AND t.org_id = ${orgId} AND t.id = ${tagId}
      JOIN companies co ON co.id = p.company_id
     WHERE (p.posted_at AT TIME ZONE 'America/New_York')::date = ${bucket}::date
       AND coalesce(btrim(p.text), '') <> ''
     ORDER BY p.engagement_total DESC NULLS LAST
     LIMIT ${MAX_POSTS_PER_NARRATIVE}`);
  return rows.map((r, index) => ({
    company: r.company,
    platform: r.platform,
    text: r.text ?? '',
    rank: index + 1,
  }));
}

function dayLabel(bucket: string): string {
  const parsed = new Date(`${bucket}T12:00:00Z`);
  return Number.isNaN(parsed.getTime())
    ? bucket
    : parsed.toLocaleDateString('en-US', {
      weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC',
    });
}

/** One tick: narrate up to DAYS_PER_TICK story-days for this org. */
export async function runNarrativeTick(orgId: string): Promise<NarrativeTickResult> {
  const base: NarrativeTickResult = {
    orgId, candidates: 0, written: 0, rejected: 0, spentUsd: 0,
  };

  const spent = await spentTodayUsd(orgId);
  if (spent >= dailyBudgetUsd()) return { ...base, skipped: 'narrative budget reached' };

  const days = await candidates(orgId);
  base.candidates = days.length;
  if (days.length === 0) return { ...base, skipped: 'no days need narrating' };

  let spentThisTick = 0;
  const startedAt = Date.now();
  for (const day of days) {
    if (spent + spentThisTick >= dailyBudgetUsd()) {
      base.skipped = 'narrative budget reached mid-tick';
      break;
    }
    if (Date.now() - startedAt > TICK_MS_BUDGET) {
      base.skipped = 'tick time budget reached';
      break;
    }
    const posts = await postsForDay(orgId, day.tagId, day.bucket);
    if (posts.length < MIN_POSTS_FOR_NARRATIVE) continue;

    try {
      const completion = await complete(
        orgId,
        {
          messages: buildNarrativeMessages({
            tagName: day.tagName,
            tagDefinition: day.tagDefinition,
            dayLabel: dayLabel(day.bucket),
            posts,
          }),
          jsonSchema: NARRATIVE_SCHEMA as unknown as Record<string, unknown>,
          maxTokens: 600,
          temperature: 0.2,
        },
        { feature: 'story-narrative' },
      );
      spentThisTick += completion.costUsd;

      const text = validateNarrative(completion.json ?? safeParse(completion.text));
      if (!text) { base.rejected += 1; continue; }

      await db.execute(sql`
        INSERT INTO story_narratives
          (org_id, tag_id, bucket_date, granularity, narrative,
           posts_considered, engagement_at_write, model, generated_at)
        VALUES (${orgId}, ${day.tagId}, ${day.bucket}::date, 'day', ${text},
                ${posts.length}, ${day.engagement}, ${completion.model}, now())
        ON CONFLICT (org_id, tag_id, bucket_date, granularity) DO UPDATE
          SET narrative = excluded.narrative,
              posts_considered = excluded.posts_considered,
              engagement_at_write = excluded.engagement_at_write,
              model = excluded.model,
              generated_at = now()`);
      base.written += 1;
    } catch {
      // A failed day is retried on the next tick by the same selection rule.
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
