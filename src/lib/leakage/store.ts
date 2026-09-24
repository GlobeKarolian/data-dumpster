import 'server-only';
import { sql } from 'drizzle-orm';
import { db } from '@/db';
import type { SharePost, ShareSummary } from './story-shares';
import type { LeakageAnalysis } from './analysis';
import type { StoryMeta } from './story-page';

/**
 * Saved Article Leakage runs. The tables are created on first use with
 * idempotent DDL (and are also in drizzle/0038_leakage_runs.sql) because this
 * feature is new, additive and single-user: nothing else reads or writes them,
 * so a first request creating them cannot race or break an existing screen.
 */
const DDL = [
  sql`CREATE TABLE IF NOT EXISTS leakage_runs (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id uuid NOT NULL,
    created_by uuid,
    story_key text NOT NULL,
    story_url text NOT NULL,
    terms text[] NOT NULL DEFAULT '{}',
    window_label text NOT NULL,
    summary jsonb NOT NULL,
    queries jsonb NOT NULL,
    accounts jsonb NOT NULL,
    posts jsonb NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now()
  )`,
  sql`CREATE INDEX IF NOT EXISTS leakage_runs_org_created_idx ON leakage_runs (org_id, created_at DESC)`,
  sql`CREATE INDEX IF NOT EXISTS leakage_runs_org_story_idx ON leakage_runs (org_id, story_key, created_at DESC)`,
  sql`ALTER TABLE leakage_runs ADD COLUMN IF NOT EXISTS story_meta jsonb`,
  sql`ALTER TABLE leakage_runs ADD COLUMN IF NOT EXISTS analysis jsonb`,
];

let ready: Promise<void> | null = null;
export function ensureLeakageSchema(): Promise<void> {
  ready ??= (async () => {
    for (const statement of DDL) await db.execute(statement);
  })().catch((error) => {
    ready = null;
    throw error;
  });
  return ready;
}

export interface SavedRunInput {
  orgId: string;
  userId: string | null;
  storyKey: string;
  storyUrl: string;
  terms: string[];
  windowLabel: string;
  summary: ShareSummary & { capped: boolean };
  queries: unknown;
  accounts: unknown;
  posts: SharePost[];
  storyMeta: StoryMeta | null;
}

export async function saveRun(run: SavedRunInput): Promise<string> {
  await ensureLeakageSchema();
  const { rows } = await db.execute<{ id: string }>(sql`
    INSERT INTO leakage_runs (org_id, created_by, story_key, story_url, terms, window_label, summary, queries, accounts, posts, story_meta)
    VALUES (${run.orgId}::uuid, ${run.userId}::uuid, ${run.storyKey}, ${run.storyUrl},
            -- A JS array param expands to a tuple, which cannot cast to text[];
            -- pass JSON and unpack it, which also handles an empty list.
            ARRAY(SELECT jsonb_array_elements_text(${JSON.stringify(run.terms)}::jsonb)), ${run.windowLabel},
            ${JSON.stringify(run.summary)}::jsonb, ${JSON.stringify(run.queries)}::jsonb,
            ${JSON.stringify(run.accounts)}::jsonb, ${JSON.stringify(run.posts)}::jsonb,
            ${run.storyMeta ? JSON.stringify(run.storyMeta) : null}::jsonb)
    RETURNING id`);
  return rows[0].id;
}

export type RunListItem = {
  id: string;
  story_key: string;
  story_url: string;
  terms: string[];
  created_at: string;
  people: number;
  views: number;
  leaked: number;
  leak_share: number | null;
  runs_for_story: number;
  headline: string | null;
};

export async function listRuns(orgId: string): Promise<RunListItem[]> {
  await ensureLeakageSchema();
  const { rows } = await db.execute<RunListItem>(sql`
    SELECT id, story_key, story_url, terms,
           to_char(created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS created_at,
           coalesce((summary->>'people')::int, 0) AS people,
           coalesce((summary->>'views')::bigint, 0) AS views,
           coalesce((summary->'leaked'->>'posts')::int, 0) AS leaked,
           (summary->>'leakShareOfLinks')::float AS leak_share,
           count(*) OVER (PARTITION BY story_key)::int AS runs_for_story,
           story_meta->>'headline' AS headline
      FROM leakage_runs
     WHERE org_id = ${orgId}::uuid
     ORDER BY created_at DESC
     LIMIT 200`);
  return rows.map((r) => ({ ...r, views: Number(r.views) }));
}

export async function getRun(orgId: string, id: string) {
  await ensureLeakageSchema();
  const { rows } = await db.execute<{
    id: string; story_key: string; story_url: string; terms: string[]; window_label: string;
    summary: unknown; queries: unknown; accounts: unknown; posts: unknown; created_at: string;
    story_meta: StoryMeta | null; analysis: LeakageAnalysis | null;
  }>(sql`
    SELECT id, story_key, story_url, terms, window_label, summary, queries, accounts, posts, story_meta, analysis,
           to_char(created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS created_at
      FROM leakage_runs
     WHERE org_id = ${orgId}::uuid AND id = ${id}::uuid`);
  return rows[0] ?? null;
}

export type RepeatLeaker = {
  author: string;
  stories: number;
  leaks: number;
  views: number;
  followers: number;
  tools: string[];
  last_seen: string | null;
  story_keys: string[];
};

/**
 * Accounts that shared archive or bypass copies, across the latest run of
 * every story checked. "Repeat" means more than one story; the list is sorted
 * so those come first.
 */
export async function repeatLeakers(orgId: string): Promise<RepeatLeaker[]> {
  await ensureLeakageSchema();
  const { rows } = await db.execute<RepeatLeaker>(sql`
    WITH latest AS (
      SELECT DISTINCT ON (story_key) story_key, posts
        FROM leakage_runs
       WHERE org_id = ${orgId}::uuid
       ORDER BY story_key, created_at DESC
    ),
    leaks AS (
      SELECT l.story_key, p
        FROM latest l, jsonb_array_elements(l.posts) p
       WHERE p->>'link' = 'bypass' AND lower(p->>'author') <> 'grok'
    )
    SELECT p->>'author' AS author,
           count(DISTINCT story_key)::int AS stories,
           count(*)::int AS leaks,
           coalesce(sum((p->>'views')::bigint), 0)::bigint AS views,
           max((p->>'followers')::bigint)::bigint AS followers,
           array_remove(array_agg(DISTINCT p->>'tool'), NULL) AS tools,
           max(p->>'createdAt') AS last_seen,
           array_agg(DISTINCT story_key) AS story_keys
      FROM leaks
     GROUP BY p->>'author'
     ORDER BY count(DISTINCT story_key) DESC, count(*) DESC, sum((p->>'views')::bigint) DESC
     LIMIT 500`);
  return rows.map((r) => ({ ...r, views: Number(r.views), followers: Number(r.followers) }));
}

export async function saveAnalysis(orgId: string, id: string, analysis: LeakageAnalysis): Promise<void> {
  await ensureLeakageSchema();
  await db.execute(sql`
    UPDATE leakage_runs SET analysis = ${JSON.stringify(analysis)}::jsonb
     WHERE org_id = ${orgId}::uuid AND id = ${id}::uuid`);
}
