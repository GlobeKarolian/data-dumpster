import 'server-only';
import { and, desc, eq } from 'drizzle-orm';
import { sql } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '@/db';
import { modelConnections } from '@/db/schema';
import { complete, resolveConnection } from '@/lib/ai/client';
import { ModelError, type ResolvedModelConnection } from '@/lib/ai/types';
import { HttpError } from '@/lib/session';
import { extractArticle, type Article } from './article-extract';
import {
  DEFAULT_DRAFT_MODEL, buildDraftMessages, checkDraft, draftSchema, mergePrompts, readDrafts, textBudget,
  type DraftAccount, type DraftPrompts,
} from './drafting-core';
import { PUBLISH_PLATFORMS, linkModeFor } from './platforms';
import { fetchPage } from './preview';
import { getTargets, q } from './store';
import { applyUtm } from './utm';

/**
 * Paste a story link, get a post per account: read the story, ask the model
 * (OpenRouter by default) for one post per network, then check every number
 * and quote against the story before the editor sees it. Nothing is posted
 * here; the drafts land in the composer for a person to edit and schedule.
 */

/* --------------------------------------------------------------- settings */

export interface DraftSettings {
  model: string;
  prompts: DraftPrompts;
  /** Raw saved values, so Settings can show which fields differ from the default. */
  saved: { model: string | null; house: string | null; platforms: Partial<Record<string, string>> };
  updatedBy: string | null;
  updatedAt: string | null;
}

export async function getDraftSettings(orgId: string): Promise<DraftSettings> {
  const rows = await q<{ draft_model: string | null; draft_prompts: { house?: string; platforms?: Record<string, string> } | null; draft_updated_by: string | null; draft_updated_at: string | null }>(sql`
    SELECT draft_model, draft_prompts, draft_updated_by,
           to_char(draft_updated_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS draft_updated_at
      FROM publish_settings WHERE org_id = ${orgId}::uuid`);
  const r = rows[0];
  const saved = r?.draft_prompts ?? {};
  return {
    model: r?.draft_model?.trim() || DEFAULT_DRAFT_MODEL,
    prompts: mergePrompts(saved),
    saved: { model: r?.draft_model ?? null, house: saved.house ?? null, platforms: saved.platforms ?? {} },
    updatedBy: r?.draft_updated_by ?? null,
    updatedAt: r?.draft_updated_at ?? null,
  };
}

export const draftSettingsSchema = z.object({
  model: z.string().trim().max(120).nullable(),
  house: z.string().max(6000).nullable(),
  platforms: z.partialRecord(z.enum(PUBLISH_PLATFORMS), z.string().max(3000)).default({}),
});

/** Blank fields are stored as "use the default", so improving a default reaches every org that never changed it. */
export async function saveDraftSettings(orgId: string, input: z.infer<typeof draftSettingsSchema>, by: string | null) {
  const platforms = Object.fromEntries(Object.entries(input.platforms).map(([k, v]) => [k, v.trim()]).filter(([, v]) => v));
  const prompts = { ...(input.house?.trim() ? { house: input.house.trim() } : {}), platforms };
  await q(sql`INSERT INTO publish_settings (org_id, draft_model, draft_prompts, draft_updated_by, draft_updated_at)
    VALUES (${orgId}::uuid, ${input.model?.trim() || null}, ${JSON.stringify(prompts)}::jsonb, ${by}, now())
    ON CONFLICT (org_id) DO UPDATE SET draft_model = EXCLUDED.draft_model, draft_prompts = EXCLUDED.draft_prompts,
      draft_updated_by = EXCLUDED.draft_updated_by, draft_updated_at = EXCLUDED.draft_updated_at`);
  return getDraftSettings(orgId);
}

/* ------------------------------------------------------------- connection */

/**
 * The org's OpenRouter connection if it has one (Settings > AI Model), else its
 * default model connection, else OPENROUTER_API_KEY from the environment.
 */
export async function draftConnection(orgId: string): Promise<ResolvedModelConnection> {
  const rows = await db.select({ id: modelConnections.id }).from(modelConnections)
    .where(and(eq(modelConnections.orgId, orgId), eq(modelConnections.enabled, true), eq(modelConnections.provider, 'openrouter')))
    .orderBy(desc(modelConnections.isDefault), desc(modelConnections.createdAt))
    .limit(1);
  return resolveConnection(orgId, rows[0]?.id);
}

/** For Settings: which connection drafting will use, or why there is none. */
export async function draftConnectionStatus(orgId: string): Promise<{ ok: boolean; label: string | null; provider: string | null; note: string | null }> {
  try {
    const c = await draftConnection(orgId);
    const routable = c.provider === 'openrouter' || c.provider === 'openai' || c.provider === 'openai_compatible';
    return {
      ok: true, label: c.label, provider: c.provider,
      note: routable ? null : `This connection always uses its own model (${c.model}); the model chosen here applies to OpenRouter connections.`,
    };
  } catch (err) {
    return { ok: false, label: null, provider: null, note: (err as Error).message };
  }
}

/* ------------------------------------------------------------------ draft */

export interface DraftResult {
  article: Pick<Article, 'title' | 'description' | 'image' | 'byline' | 'words' | 'source'>;
  drafts: { targetId: string; text: string; warnings: string[] }[];
  model: string;
  costUsd: number;
}

export async function readArticle(url: string): Promise<Article> {
  const page = await fetchPage(url, 3_000_000);
  if (!page) throw new HttpError(422, 'Could not open that link. Check that it is a public story page.', 'unreadable');
  return extractArticle(page.html, url);
}

export async function draftPosts(orgId: string, url: string, targetIds: string[]): Promise<DraftResult> {
  const targets = await getTargets(orgId, targetIds);
  if (!targets.length) throw new HttpError(400, 'Choose at least one account to draft for.');

  const [article, settings] = await Promise.all([readArticle(url), getDraftSettings(orgId)]);
  if (!article.text.trim()) throw new HttpError(422, 'That page has no story text to draft from.', 'unreadable');

  const accounts: DraftAccount[] = targets.map((t, i) => {
    const linkMode = linkModeFor(t.platform, t.provider);
    const sentLink = linkMode === 'text'
      ? applyUtm(url, t.utm, { platform: t.platform, brand: t.brand, postRef: 'xxxxxxxx', origin: 'manual', date: new Date() })
      : null;
    return { key: `a${i + 1}`, targetId: t.id, brand: t.brand, platform: t.platform, linkMode, sentLink };
  });
  const keys = accounts.map((a) => a.key);

  let conn: ResolvedModelConnection;
  try {
    conn = await draftConnection(orgId);
  } catch (err) {
    throw new HttpError(409, (err as Error).message, 'no_model');
  }

  let res;
  try {
    res = await complete(orgId, {
      messages: buildDraftMessages(article, accounts, settings.prompts),
      jsonSchema: draftSchema(keys),
      model: settings.model,
      temperature: 0.5,
      maxTokens: Math.min(4000, 400 + accounts.length * 350),
      signal: AbortSignal.timeout(60_000),
    }, { connection: conn, feature: 'publish_draft', maxAttempts: 2 });
  } catch (err) {
    const msg = err instanceof ModelError ? err.message : String(err);
    throw new HttpError(502, `The model could not draft this story: ${msg}`, 'model_failed');
  }

  const posts = readDrafts(res.json, keys);
  if (!posts.size) throw new HttpError(502, 'The model replied without usable drafts. Try again, or try another model in Settings.', 'model_failed');

  const source = [article.title, article.description, article.publishedAt ?? '', article.text].join('\n');
  return {
    article: { title: article.title, description: article.description, image: article.image, byline: article.byline, words: article.words, source: article.source },
    drafts: accounts.filter((a) => posts.has(a.key)).map((a) => {
      const text = posts.get(a.key)!;
      return { targetId: a.targetId, text, warnings: checkDraft(text, source, textBudget(a), a.platform) };
    }),
    model: res.model,
    costUsd: res.costUsd,
  };
}
