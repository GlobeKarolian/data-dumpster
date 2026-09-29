import 'server-only';
import { sql } from 'drizzle-orm';
import { db } from '@/db';
import { DATASETS, PendingSnapshotError, scrapeSync } from '@/lib/vendors/brightdata';
import { installSpendMeter } from '@/lib/vendors/meter';
import { playsByShortcode, reelShortcode } from '@/lib/adapters/instagram-reel-plays';

/**
 * Fill in plays for recent Instagram reels from Bright Data's Reels dataset
 * (the posts dataset returns none). Each reel from the last eight days is
 * checked at most once a day, twenty URLs per purchase. A snapshot still
 * running at the deadline is saved and resumed next time, never re-bought.
 * Spend is metered like every other Bright Data purchase.
 */
installSpendMeter();

const LOOKBACK_DAYS = 8;
const RECHECK_HOURS = 20;
const BATCH = 20;
const DEFAULT_MAX_REELS = 400;
const BUDGET_MS = 230_000;

const DDL = [
  sql`CREATE TABLE IF NOT EXISTS instagram_play_checks (
    post_id uuid PRIMARY KEY,
    checked_at timestamptz NOT NULL DEFAULT now(),
    plays bigint
  )`,
  sql`CREATE TABLE IF NOT EXISTS instagram_play_snapshots (
    snapshot_id text PRIMARY KEY,
    post_ids jsonb NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now()
  )`,
];
let ready: Promise<void> | null = null;
function ensureTables(): Promise<void> {
  ready ??= (async () => { for (const s of DDL) await db.execute(s); })().catch((e) => { ready = null; throw e; });
  return ready;
}

type Reel = { id: string; permalink: string; engagement_total: number | string | null };

async function applyPlays(reels: Reel[], rows: Array<Record<string, unknown>>): Promise<{ updated: number; plays: number }> {
  const plays = playsByShortcode(rows);
  let updated = 0;
  let total = 0;
  for (const reel of reels) {
    const code = reelShortcode(reel.permalink);
    const value = code ? plays.get(code) : undefined;
    await db.execute(sql`
      INSERT INTO instagram_play_checks (post_id, checked_at, plays)
      VALUES (${reel.id}::uuid, now(), ${value ?? null})
      ON CONFLICT (post_id) DO UPDATE SET checked_at = now(), plays = excluded.plays`);
    if (!value) continue;
    // Plays only rise; never lower a stored count.
    const { rows: changed } = await db.execute<{ id: string }>(sql`
      UPDATE posts
         SET views = ${value},
             engagement_rate_by_view = engagement_total::double precision / ${value}
       WHERE id = ${reel.id}::uuid AND views < ${value}
      RETURNING id`);
    if (changed.length > 0) updated += 1;
    total += value;
  }
  return { updated, plays: total };
}

export interface ReelPlaysResult {
  checked: number;
  updated: number;
  plays: number;
  resumed: number;
  pendingSaved: number;
  errors: string[];
  skipped?: string;
}

export async function runReelPlays(opts: { maxReels?: number } = {}): Promise<ReelPlaysResult> {
  const result: ReelPlaysResult = { checked: 0, updated: 0, plays: 0, resumed: 0, pendingSaved: 0, errors: [] };
  const apiKey = process.env.BRIGHTDATA_API_KEY?.trim();
  if (!apiKey) return { ...result, skipped: 'BRIGHTDATA_API_KEY is not configured' };
  await ensureTables();
  const started = Date.now();
  const timeLeft = () => BUDGET_MS - (Date.now() - started);

  // Finish anything already paid for first.
  const { rows: pending } = await db.execute<{ snapshot_id: string; post_ids: string[] }>(sql`
    SELECT snapshot_id, post_ids FROM instagram_play_snapshots ORDER BY created_at LIMIT 10`);
  for (const snap of pending) {
    if (timeLeft() < 60_000) break;
    try {
      const { rows: reels } = await db.execute<Reel>(sql`
        SELECT id, permalink, engagement_total FROM posts
         WHERE id IN (SELECT (jsonb_array_elements_text(${JSON.stringify(snap.post_ids)}::jsonb))::uuid)`);
      // scrapeSync returns early on an empty input, before it looks at
      // resumeSnapshotId, so pass the original URLs (ignored when resuming).
      const inputs = reels.map((r) => ({ url: 'https://www.instagram.com/reel/' + reelShortcode(r.permalink) + '/' }));
      const rows = await scrapeSync<Record<string, unknown>>(DATASETS.instagramReel, inputs.length > 0 ? inputs : [{ url: 'resume' }], {
        apiKey, platform: 'instagram', resumeSnapshotId: snap.snapshot_id, timeoutMs: Math.min(90_000, timeLeft() - 30_000),
      });
      const applied = await applyPlays(reels, rows);
      result.updated += applied.updated;
      result.plays += applied.plays;
      result.resumed += 1;
      await db.execute(sql`DELETE FROM instagram_play_snapshots WHERE snapshot_id = ${snap.snapshot_id}`);
    } catch (error) {
      if (error instanceof PendingSnapshotError) continue;
      result.errors.push(error instanceof Error ? error.message : String(error));
      await db.execute(sql`DELETE FROM instagram_play_snapshots WHERE snapshot_id = ${snap.snapshot_id}`);
    }
  }

  const { rows: reels } = await db.execute<Reel>(sql`
    SELECT p.id, p.permalink, p.engagement_total
      FROM posts p
      LEFT JOIN instagram_play_checks c ON c.post_id = p.id
     WHERE p.platform::text = 'instagram'
       AND p.type::text IN ('reel', 'video')
       AND p.permalink IS NOT NULL
       AND p.posted_at >= now() - make_interval(days => ${LOOKBACK_DAYS})
       AND (c.checked_at IS NULL OR c.checked_at < now() - make_interval(hours => ${RECHECK_HOURS}))
       AND NOT EXISTS (
         SELECT 1 FROM instagram_play_snapshots s
          WHERE s.post_ids ? p.id::text)
     ORDER BY (p.views = 0) DESC, p.posted_at DESC
     LIMIT ${opts.maxReels ?? DEFAULT_MAX_REELS}`);

  for (let i = 0; i < reels.length; i += BATCH) {
    if (timeLeft() < 60_000) break;
    const batch = reels.slice(i, i + BATCH).filter((r) => reelShortcode(r.permalink));
    if (batch.length === 0) continue;
    try {
      const rows = await scrapeSync<Record<string, unknown>>(
        DATASETS.instagramReel,
        batch.map((r) => ({ url: 'https://www.instagram.com/reel/' + reelShortcode(r.permalink) + '/' })),
        { apiKey, platform: 'instagram', timeoutMs: Math.min(90_000, timeLeft() - 30_000), limitTotal: batch.length },
      );
      const applied = await applyPlays(batch, rows);
      result.checked += batch.length;
      result.updated += applied.updated;
      result.plays += applied.plays;
    } catch (error) {
      if (error instanceof PendingSnapshotError) {
        await db.execute(sql`
          INSERT INTO instagram_play_snapshots (snapshot_id, post_ids)
          VALUES (${error.snapshotId}, ${JSON.stringify(batch.map((r) => r.id))}::jsonb)
          ON CONFLICT (snapshot_id) DO NOTHING`);
        result.pendingSaved += 1;
        continue;
      }
      result.errors.push(error instanceof Error ? error.message : String(error));
      if (result.errors.length >= 3) break;
    }
  }
  return result;
}
