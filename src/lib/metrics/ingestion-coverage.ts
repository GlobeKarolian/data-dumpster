import { sql, type SQL } from 'drizzle-orm';
import { db } from '@/db';
import type { Platform } from '@/lib/types';

export interface IngestionCoverage {
  totalChannels: number;
  /** Profiles whose durable coverage spans the exact selected window. */
  ingestedChannels: number;
  neverAttemptedChannels: number;
  failedChannels: number;
  collectingChannels: number;
  blockedChannels: number;
  focusTotalChannels: number;
  focusIngestedChannels: number;
  focusFailedChannels: number;
}

export interface IngestionCoverageQuery {
  orgId: string;
  landscapeId: string;
  companyIds?: readonly string[];
  platforms?: readonly Platform[];
  focusCompanyId?: string | null;
  start: Date;
  end: Date;
}

interface CoverageRow extends Record<string, unknown> {
  total_channels: string | number | null;
  ingested_channels: string | number | null;
  never_attempted_channels: string | number | null;
  failed_channels: string | number | null;
  collecting_channels: string | number | null;
  blocked_channels: string | number | null;
  focus_total_channels: string | number | null;
  focus_ingested_channels: string | number | null;
  focus_failed_channels: string | number | null;
}

function uuidList(ids: readonly string[]): SQL {
  return sql.join(ids.map((id) => sql`${id}::uuid`), sql`, `);
}

function platformList(platforms: readonly Platform[]): SQL {
  return sql.join(platforms.map((platform) => sql`${platform}::platform`), sql`, `);
}

function count(value: string | number | null | undefined): number {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

/**
 * Collection coverage for the exact org-private landscape slice on screen.
 * A configured profile and a successfully collected profile are deliberately
 * separate counts; confusing those states is how missing data becomes a fake zero.
 */
export async function getIngestionCoverage(
  input: IngestionCoverageQuery,
): Promise<IngestionCoverage> {
  const companyFilter = input.companyIds?.length
    ? sql`AND ch.company_id IN (${uuidList(input.companyIds)})`
    : sql``;
  const platformFilter = input.platforms?.length
    ? sql`AND ch.platform IN (${platformList(input.platforms)})`
    : sql``;

  const { rows } = await db.execute<CoverageRow>(sql`
    WITH scoped_channels AS (
      SELECT ch.id, ch.company_id, ch.last_ingested_at
        FROM landscapes l
        JOIN landscape_companies lc ON lc.landscape_id = l.id
        JOIN channels ch ON ch.company_id = lc.company_id
       WHERE l.id = ${input.landscapeId}::uuid
         AND l.org_id = ${input.orgId}::uuid
         AND ch.active
         ${companyFilter}
         ${platformFilter}
    ),
    classified AS (
      SELECT sc.*,
             state.status,
             state.attempts,
             state.next_attempt_at,
             (
               state.status = 'succeeded'
               AND NOT state.has_more
               AND state.coverage_since::date <= ${input.start}::timestamptz::date
               AND state.coverage_until::date >= ${input.end}::timestamptz::date
             ) AS complete_for_window
        FROM scoped_channels sc
        LEFT JOIN channel_collection_state state ON state.channel_id = sc.id
    )
    SELECT count(*)::int AS total_channels,
           count(*) FILTER (WHERE complete_for_window)::int
             AS ingested_channels,
           count(*) FILTER (WHERE status IS NULL OR attempts = 0)::int
             AS never_attempted_channels,
           count(*) FILTER (WHERE status = 'failed')::int
             AS failed_channels,
           count(*) FILTER (
             WHERE status IN ('queued', 'running', 'partial') AND attempts > 0
           )::int
             AS collecting_channels,
           count(*) FILTER (WHERE status = 'failed' AND next_attempt_at IS NULL)::int
             AS blocked_channels,
           count(*) FILTER (WHERE company_id = ${input.focusCompanyId ?? null}::uuid)::int
             AS focus_total_channels,
           count(*) FILTER (
             WHERE company_id = ${input.focusCompanyId ?? null}::uuid
               AND complete_for_window
           )::int AS focus_ingested_channels,
           count(*) FILTER (
             WHERE company_id = ${input.focusCompanyId ?? null}::uuid
               AND status = 'failed'
           )::int AS focus_failed_channels
      FROM classified
  `);

  const row = rows[0];
  return {
    totalChannels: count(row?.total_channels),
    ingestedChannels: count(row?.ingested_channels),
    neverAttemptedChannels: count(row?.never_attempted_channels),
    failedChannels: count(row?.failed_channels),
    collectingChannels: count(row?.collecting_channels),
    blockedChannels: count(row?.blocked_channels),
    focusTotalChannels: count(row?.focus_total_channels),
    focusIngestedChannels: count(row?.focus_ingested_channels),
    focusFailedChannels: count(row?.focus_failed_channels),
  };
}
