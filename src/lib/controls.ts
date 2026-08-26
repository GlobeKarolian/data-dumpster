import { z } from 'zod';
import { sql } from 'drizzle-orm';
import { db } from '@/db';
import {
  IG_COMMENT_DAILY_RECORD_BUDGET,
  TIKTOK_COMMENT_DAILY_RECORD_BUDGET,
} from '@/lib/vendors/budget';

/**
 * Operator controls for the collection machinery.
 *
 * Every knob here was a hardcoded constant that could only be turned by a
 * deploy. The registry keeps the constants as defaults: a control_settings row
 * records only an operator's deliberate departure from them, so an absent row
 * always means "whatever the code ships with", resetting is deleting, and a
 * newly added control needs no backfill.
 *
 * Reads fail open to the default. A malformed row must never take down a cron
 * tick, because the tick is the paid work; it is logged and ignored instead.
 */

const commentPlatformSchema = z.object({
  enabled: z.boolean(),
  dailyRecordBudget: z.number().int().min(0).max(1_000_000),
});

export const controlSchemas = {
  comments: z.object({
    enabled: z.boolean(),
    minPostAgeHours: z.number().int().min(0).max(168),
    maxPostAgeDays: z.number().int().min(1).max(90),
    postsPerPlatformPerTick: z.number().int().min(1).max(50),
    commentsPerPost: z.number().int().min(10).max(1_000),
    platforms: z.object({
      instagram: commentPlatformSchema,
      tiktok: commentPlatformSchema,
    }),
    /** Companies whose posts never get comment sections bought. */
    excludedCompanyIds: z.array(z.uuid()).max(500),
    /**
     * Which landscapes' posts get comment sections at all. 'all' is the
     * shipped behavior; 'selected' buys only for posts whose company belongs
     * to at least one toggled-on landscape. Pooling still applies: a company
     * in a toggled-on landscape gets comments everywhere it appears.
     */
    landscapeMode: z.enum(['all', 'selected']),
    selectedLandscapeIds: z.array(z.uuid()).max(100),
  }),
  summaries: z.object({
    enabled: z.boolean(),
    postsPerTick: z.number().int().min(1).max(100),
  }),
  ingest: z.object({
    enabled: z.boolean(),
    /** Channels the recover tick may claim. The cron URL's limit still caps it. */
    recoverChannelsPerTick: z.number().int().min(1).max(1_000),
    /** How stale a channel may grow before the recover tick re-crawls it. */
    refreshIntervalHours: z.number().int().min(1).max(168),
  }),
  groups: z.object({
    enabled: z.boolean(),
  }),
  refresh: z.object({
    enabled: z.boolean(),
  }),
} as const;

export type ControlKey = keyof typeof controlSchemas;
export type ControlValue<K extends ControlKey> = z.infer<(typeof controlSchemas)[K]>;

export const controlDefaults: { [K in ControlKey]: ControlValue<K> } = {
  comments: {
    enabled: true,
    minPostAgeHours: 12,
    maxPostAgeDays: 7,
    postsPerPlatformPerTick: 5,
    commentsPerPost: 100,
    platforms: {
      instagram: { enabled: true, dailyRecordBudget: IG_COMMENT_DAILY_RECORD_BUDGET },
      tiktok: { enabled: true, dailyRecordBudget: TIKTOK_COMMENT_DAILY_RECORD_BUDGET },
    },
    excludedCompanyIds: [],
    landscapeMode: 'all',
    selectedLandscapeIds: [],
  },
  summaries: { enabled: true, postsPerTick: 12 },
  ingest: { enabled: true, recoverChannelsPerTick: 250, refreshIntervalHours: 12 },
  groups: { enabled: true },
  refresh: { enabled: true },
};

/**
 * Overlay a stored value onto the default, one level deep per object field.
 * A row written before a control grew a new field stays valid: the new field
 * arrives from the default rather than failing the whole row.
 */
function overlay(base: unknown, stored: unknown): unknown {
  if (
    base !== null && stored !== null
    && typeof base === 'object' && typeof stored === 'object'
    && !Array.isArray(base) && !Array.isArray(stored)
  ) {
    const out: Record<string, unknown> = { ...(base as Record<string, unknown>) };
    for (const [key, value] of Object.entries(stored as Record<string, unknown>)) {
      out[key] = key in out ? overlay(out[key], value) : value;
    }
    return out;
  }
  return stored;
}

export async function readControl<K extends ControlKey>(key: K): Promise<ControlValue<K>> {
  const fallback = controlDefaults[key];
  try {
    const { rows } = await db.execute<{ value: unknown }>(sql`
      SELECT value FROM control_settings WHERE key = ${key}`);
    if (rows.length === 0) return fallback;
    const parsed = controlSchemas[key].safeParse(overlay(fallback, rows[0].value));
    if (!parsed.success) {
      console.error('[data-dumpster:controls] stored control is malformed, using default', {
        key, issues: parsed.error.issues.slice(0, 3),
      });
      return fallback;
    }
    return parsed.data as ControlValue<K>;
  } catch (error) {
    console.error('[data-dumpster:controls] control read failed, using default', {
      key, error: error instanceof Error ? error.message : 'unknown',
    });
    return fallback;
  }
}

export async function readAllControls(): Promise<{ [K in ControlKey]: ControlValue<K> }> {
  const entries = await Promise.all(
    (Object.keys(controlSchemas) as ControlKey[]).map(
      async (key) => [key, await readControl(key)] as const,
    ),
  );
  return Object.fromEntries(entries) as { [K in ControlKey]: ControlValue<K> };
}

export async function writeControl<K extends ControlKey>(
  key: K,
  value: unknown,
  updatedBy: string | null,
): Promise<ControlValue<K>> {
  const parsed = controlSchemas[key].parse(value);
  await db.execute(sql`
    INSERT INTO control_settings (key, value, updated_by, updated_at)
    VALUES (${key}, ${JSON.stringify(parsed)}::jsonb, ${updatedBy}, now())
    ON CONFLICT (key) DO UPDATE
      SET value = excluded.value,
          updated_by = excluded.updated_by,
          updated_at = now()`);
  return parsed as ControlValue<K>;
}

export const controlsTestHelpers = { overlay };
