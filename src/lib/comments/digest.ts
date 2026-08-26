/**
 * The daily comment digest: one paragraph for the whole region.
 *
 * Per-post summaries answer "what is this section arguing about"; nobody in a
 * newsroom reads forty of them. This rolls the live day's summaries into a
 * single model-written digest for the Today page, regenerated in place as new
 * sections arrive, at most once per REGENERATE_MINUTES so a busy tick does
 * not buy the same paragraph six times an hour.
 *
 * Day boundaries are report-zone days (America/New_York), matching how every
 * other daily artifact in the product counts a "day".
 */
import { sql } from 'drizzle-orm';
import { db } from '@/db';
import { complete } from '@/lib/ai/client';
import { orgsWithAiTags } from '@/lib/tagging/queue';
import { readControl } from '@/lib/controls';

const REGENERATE_MINUTES = 30;
const MAX_SUMMARIES = 60;

export interface CommentDigestResult {
  written: boolean;
  summariesConsidered: number;
  skipped?: string;
}

export async function runCommentDigestTick(): Promise<CommentDigestResult> {
  const controls = await readControl('summaries');
  if (!controls.enabled) {
    return { written: false, summariesConsidered: 0, skipped: 'summaries are switched off' };
  }

  const orgId = (await orgsWithAiTags())[0];
  if (!orgId) {
    return { written: false, summariesConsidered: 0, skipped: 'no org with a model connection' };
  }

  // The live report-zone day, plus staleness: regenerate only when new
  // summaries landed after the current digest was written, and not more often
  // than the regeneration interval.
  const { rows: state } = await db.execute<{
    day: string;
    fresh_summaries: string | number;
    digest_age_minutes: string | number | null;
  }>(sql`
    SELECT (now() AT TIME ZONE 'America/New_York')::date::text AS day,
           (SELECT count(*) FROM comment_summaries cs
             WHERE cs.summary IS NOT NULL
               AND cs.generated_at > coalesce(
                     (SELECT d.generated_at FROM daily_comment_digests d
                       WHERE d.day = (now() AT TIME ZONE 'America/New_York')::date),
                     'epoch'::timestamptz))
             AS fresh_summaries,
           (SELECT extract(epoch FROM now() - d.generated_at) / 60
              FROM daily_comment_digests d
             WHERE d.day = (now() AT TIME ZONE 'America/New_York')::date)
             AS digest_age_minutes`);
  const today = state[0];
  const freshSummaries = Number(today.fresh_summaries) || 0;
  const ageMinutes = today.digest_age_minutes === null ? null : Number(today.digest_age_minutes);

  if (freshSummaries === 0) {
    return { written: false, summariesConsidered: 0, skipped: 'no new summaries since last digest' };
  }
  if (ageMinutes !== null && ageMinutes < REGENERATE_MINUTES) {
    return { written: false, summariesConsidered: 0, skipped: 'digest is fresh enough' };
  }

  // Everything summarized in the live day, loudest sections first. The digest
  // describes the day, not the delta, so it re-reads the whole day each time.
  const { rows: summaries } = await db.execute<{
    company: string; summary: string; comments: string | number;
  }>(sql`
    SELECT co.name AS company, cs.summary, cs.comments_considered AS comments
      FROM comment_summaries cs
      JOIN posts p ON p.id = cs.post_id
      JOIN companies co ON co.id = p.company_id
     WHERE cs.summary IS NOT NULL
       AND (cs.generated_at AT TIME ZONE 'America/New_York')::date
           = (now() AT TIME ZONE 'America/New_York')::date
     ORDER BY cs.comments_considered DESC
     LIMIT ${MAX_SUMMARIES}`);
  if (summaries.length === 0) {
    return { written: false, summariesConsidered: 0, skipped: 'no summaries in the live day yet' };
  }

  // Plain prose deliberately: the digest is one paragraph, and a JSON wrapper
  // around a single string adds nothing except a way for a model to truncate
  // itself into a parse failure.
  const completion = await complete(
    orgId,
    {
      messages: [
        {
          role: 'system',
          content:
            'You distill a day of social comment-section summaries from Boston '
            + 'news outlets into one short digest for a newsroom dashboard. Write '
            + 'two to four sentences on what people are collectively arguing '
            + 'over and how the mood runs: concrete and specific, naming outlets '
            + 'or stories where it helps. Never invent stories not present in '
            + 'the input. Reply with the digest paragraph only, no preamble, no '
            + 'bullet points, no quotation marks around the whole answer.',
        },
        {
          role: 'user',
          content: summaries
            .map((row) => row.company + ' (' + row.comments + ' comments): ' + row.summary)
            .join('\n'),
        },
      ],
      maxTokens: 500,
      temperature: 0.3,
    },
    { feature: 'comment-digest' },
  );

  const digest = completion.text.trim();
  if (!digest) {
    return { written: false, summariesConsidered: summaries.length, skipped: 'model returned no digest' };
  }

  await db.execute(sql`
    INSERT INTO daily_comment_digests (day, digest, summaries_considered, model, generated_at)
    VALUES (${today.day}::date, ${digest}, ${summaries.length}, ${completion.model ?? null}, now())
    ON CONFLICT (day) DO UPDATE
      SET digest = excluded.digest,
          summaries_considered = excluded.summaries_considered,
          model = excluded.model,
          generated_at = now()`);
  return { written: true, summariesConsidered: summaries.length };
}
