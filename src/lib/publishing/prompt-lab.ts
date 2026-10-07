import 'server-only';
import { sql } from 'drizzle-orm';
import { z } from 'zod';
import { complete } from '@/lib/ai/client';
import { ModelError } from '@/lib/ai/types';
import { verifyNumbersAgainstMaterial } from '@/lib/ai/verify';
import { HttpError } from '@/lib/session';
import { draftConnection, getDraftSettings } from './drafting';
import { PUBLISH_PLATFORMS, type PublishPlatform } from './platforms';
import {
  buildFactSheet, buildLabMessages, labSchema, pickExamples, readSuggestion, renderFactSheet, splitByLift,
  type FactSheet, type LabPost, type LabSuggestion,
} from './prompt-lab-core';
import { fitModel, renderModel, type ModelReport } from './prompt-lab-model';
import { q } from './store';

/**
 * Runs the Prompt Lab (see prompt-lab-core.ts) against the posts Data Dumpster
 * has collected for the landscapes an admin picks. Read-only: suggestions come
 * back to Settings, and nothing changes until an admin keeps one and saves.
 */

export const LAB_MODEL = 'anthropic/claude-opus-5.5';
const MIN_POSTS = 150;

export const labRequestSchema = z.object({
  landscapeIds: z.array(z.string().uuid()).min(1).max(6),
  days: z.union([z.literal(90), z.literal(180), z.literal(365)]).default(180),
  platforms: z.array(z.enum(PUBLISH_PLATFORMS)).min(1).max(PUBLISH_PLATFORMS.length).optional(),
  model: z.string().trim().min(3).max(120).optional(),
});

export interface LabResult {
  platform: PublishPlatform;
  skipped?: string;
  facts?: FactSheet;
  model?: ModelReport;
  suggestion?: LabSuggestion;
  /** Reasons removed because a number in them is not in the measurements. */
  droppedReasons?: number;
  examples?: { company: string; lift: number; text: string }[];
  costUsd?: number;
}

/** Posts with text on one network, each scored against its own account's median, collabs counted once. */
export async function labPosts(orgId: string, landscapeIds: string[], platform: PublishPlatform, days: number): Promise<LabPost[]> {
  const rows = await q<{ company: string; type: string; text: string; engagement: number; lift: number; hour: number; story: string | null; tags: string[] | null }>(sql`
    WITH scope AS (
      SELECT DISTINCT lc.company_id FROM landscape_companies lc JOIN landscapes l ON l.id = lc.landscape_id
       WHERE l.org_id = ${orgId}::uuid AND l.id IN (SELECT jsonb_array_elements_text(${JSON.stringify(landscapeIds)}::jsonb)::uuid)
    ),
    win AS (
      SELECT p.id, p.channel_id, p.company_id, p.external_id, p.type::text AS type, p.text, p.engagement_total, p.posted_at
        FROM posts p
       WHERE p.company_id IN (SELECT company_id FROM scope)
         AND p.platform::text = ${platform}
         AND p.posted_at >= now() - make_interval(days => ${days})
         AND p.posted_at < now() - interval '2 days'
         AND p.type::text NOT IN ('repost', 'story', 'live', 'poll')
    ),
    med AS (
      SELECT channel_id, percentile_cont(0.5) WITHIN GROUP (ORDER BY engagement_total) AS med
        FROM win GROUP BY channel_id HAVING count(*) >= 15
    ),
    picked AS (
      SELECT DISTINCT ON (w.external_id) w.id, c.name AS company, w.type, left(w.text, 1500) AS text,
             w.engagement_total::float8 AS engagement, (w.engagement_total / m.med)::float8 AS lift,
             extract(hour FROM w.posted_at AT TIME ZONE 'America/New_York')::int AS hour
        FROM win w JOIN med m ON m.channel_id = w.channel_id JOIN companies c ON c.id = w.company_id
       WHERE m.med > 0 AND w.text IS NOT NULL AND length(btrim(w.text)) >= 15
       ORDER BY w.external_id, w.engagement_total DESC
    )
    SELECT x.company, x.type, x.text, x.engagement, x.lift, x.hour,
           (SELECT coalesce(u.canonical_url, u.url) FROM posted_urls u WHERE u.post_id = x.id ORDER BY u.url LIMIT 1) AS story,
           (SELECT json_agg(t.name) FROM post_tag_assignments a JOIN post_tags t ON t.id = a.tag_id
             WHERE a.post_id = x.id AND t.org_id = ${orgId}::uuid) AS tags
      FROM picked x`);
  return rows.map((r) => ({
    company: r.company, type: r.type, text: r.text, engagement: Number(r.engagement), lift: Number(r.lift),
    hour: Number(r.hour), story: r.story, tags: Array.isArray(r.tags) ? r.tags : [],
  }));
}

/** Every k-th post, so typical examples span the middle half instead of bunching at one end. */
function spread<T>(xs: T[], n: number): T[] {
  if (xs.length <= n) return xs;
  const step = xs.length / n;
  return Array.from({ length: n }, (_, i) => xs[Math.floor(i * step)]);
}

async function labOne(orgId: string, platform: PublishPlatform, input: z.infer<typeof labRequestSchema>): Promise<LabResult> {
  const posts = await labPosts(orgId, input.landscapeIds, platform, input.days);
  if (posts.length < MIN_POSTS) {
    return { platform, skipped: `Only ${posts.length} posts with text in these landscapes; at least ${MIN_POSTS} are needed to learn from.` };
  }
  const facts = buildFactSheet(platform, input.days, posts);
  const { top, typical } = splitByLift(posts);
  const settings = await getDraftSettings(orgId);
  const model = fitModel(posts);
  const material = [renderFactSheet(facts), renderModel(model)].filter(Boolean).join('\n');

  let res;
  try {
    res = await complete(orgId, {
      messages: buildLabMessages(facts, material, pickExamples(top, 25), spread(pickExamples(typical, 60, 4), 15), settings.prompts.platforms[platform], settings.prompts.house),
      jsonSchema: labSchema(),
      model: input.model ?? LAB_MODEL,
      temperature: 0.3,
      maxTokens: 2500,
      signal: AbortSignal.timeout(150_000),
    }, { connection: await draftConnection(orgId), feature: 'publish_prompt_lab', maxAttempts: 2 });
  } catch (err) {
    return { platform, facts, model, skipped: `The model could not finish: ${err instanceof ModelError ? err.message : String(err)}` };
  }

  const suggestion = readSuggestion(res.json, platform);
  if (!suggestion) return { platform, facts, model, skipped: 'The model replied without a usable instruction. Try again.' };
  const kept = suggestion.reasons.filter((r) => verifyNumbersAgainstMaterial(r.evidence, material).ok);
  return {
    platform, facts, model,
    suggestion: { ...suggestion, reasons: kept },
    droppedReasons: suggestion.reasons.length - kept.length,
    examples: pickExamples(top, 3, 1).map((p) => ({ company: p.company, lift: Math.round(p.lift * 10) / 10, text: p.text.slice(0, 500) })),
    costUsd: res.costUsd,
  };
}

export async function runPromptLab(orgId: string, input: z.infer<typeof labRequestSchema>): Promise<LabResult[]> {
  try {
    await draftConnection(orgId);
  } catch (err) {
    throw new HttpError(409, (err as Error).message, 'no_model');
  }
  const platforms = input.platforms ?? [...PUBLISH_PLATFORMS];
  // Networks run side by side; each is one database read and one model call.
  return Promise.all(platforms.map((p) => labOne(orgId, p, input)));
}
