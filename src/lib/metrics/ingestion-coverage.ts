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
  /** Source completed a useful read but cannot certify the selected history. */
  limitedChannels: number;
  /** Useful or certified coverage exists, but it does not span the whole window. */
  partialChannels: number;
  blockedChannels: number;
  focusTotalChannels: number;
  focusIngestedChannels: number;
  focusFailedChannels: number;
  focusLimitedChannels: number;
  focusPartialChannels: number;
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
  limited_channels: string | number | null;
  partial_channels: string | number | null;
  blocked_channels: string | number | null;
  focus_total_channels: string | number | null;
  focus_ingested_channels: string | number | null;
  focus_failed_channels: string | number | null;
  focus_limited_channels: string | number | null;
  focus_partial_channels: string | number | null;
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
      SELECT ch.id,
             ch.company_id,
             demand.channel_id AS demand_channel_id,
             demand.required_since,
             demand.required_until
        FROM landscapes l
        JOIN landscape_companies lc ON lc.landscape_id = l.id
        JOIN channels ch ON ch.company_id = lc.company_id
        LEFT JOIN landscape_channel_demands demand
          ON demand.landscape_id = l.id
         AND demand.channel_id = ch.id
       WHERE l.id = ${input.landscapeId}::uuid
         AND l.org_id = ${input.orgId}::uuid
         AND ch.active
         ${companyFilter}
         ${platformFilter}
    ),
    coverage AS (
      SELECT sc.*,
             state.status,
             state.outcome,
             state.attempts,
             state.next_attempt_at,
             (
               sc.demand_channel_id IS NOT NULL
               AND state.coverage_since <= least(
                 coalesce(sc.required_since, ${input.start}::timestamptz),
                 ${input.start}::timestamptz
               )
               AND state.coverage_until >= greatest(
                 coalesce(sc.required_until, ${input.end}::timestamptz),
                 ${input.end}::timestamptz
               )
             ) AS complete_for_window
        FROM scoped_channels sc
        LEFT JOIN channel_collection_state state ON state.channel_id = sc.id
    ),
    classified AS (
      SELECT coverage.*,
             CASE
               WHEN complete_for_window THEN 'complete'
               WHEN demand_channel_id IS NULL OR status IS NULL OR attempts = 0
                 THEN 'not_started'
               WHEN outcome = 'terminal_source_limitation' THEN 'source_limited'
               WHEN status = 'failed' AND next_attempt_at IS NULL THEN 'blocked'
               WHEN status = 'failed' THEN 'retrying'
               WHEN status IN ('queued', 'running')
                 OR (status = 'partial' AND outcome = 'continuation')
                 THEN 'collecting'
               ELSE 'partial'
             END AS coverage_state
        FROM coverage
    )
    SELECT count(*)::int AS total_channels,
           count(*) FILTER (WHERE coverage_state = 'complete')::int
             AS ingested_channels,
           count(*) FILTER (WHERE coverage_state = 'not_started')::int
             AS never_attempted_channels,
           count(*) FILTER (WHERE coverage_state IN ('blocked', 'retrying'))::int
             AS failed_channels,
           count(*) FILTER (WHERE coverage_state = 'collecting')::int
             AS collecting_channels,
           count(*) FILTER (WHERE coverage_state = 'source_limited')::int
             AS limited_channels,
           count(*) FILTER (WHERE coverage_state = 'partial')::int
             AS partial_channels,
           count(*) FILTER (WHERE coverage_state = 'blocked')::int
             AS blocked_channels,
           count(*) FILTER (WHERE company_id = ${input.focusCompanyId ?? null}::uuid)::int
             AS focus_total_channels,
           count(*) FILTER (
             WHERE company_id = ${input.focusCompanyId ?? null}::uuid
               AND coverage_state = 'complete'
           )::int AS focus_ingested_channels,
           count(*) FILTER (
             WHERE company_id = ${input.focusCompanyId ?? null}::uuid
               AND coverage_state IN ('blocked', 'retrying')
           )::int AS focus_failed_channels,
           count(*) FILTER (
             WHERE company_id = ${input.focusCompanyId ?? null}::uuid
               AND coverage_state = 'source_limited'
           )::int AS focus_limited_channels,
           count(*) FILTER (
             WHERE company_id = ${input.focusCompanyId ?? null}::uuid
               AND coverage_state = 'partial'
           )::int AS focus_partial_channels
      FROM classified
  `);

  const row = rows[0];
  return {
    totalChannels: count(row?.total_channels),
    ingestedChannels: count(row?.ingested_channels),
    neverAttemptedChannels: count(row?.never_attempted_channels),
    failedChannels: count(row?.failed_channels),
    collectingChannels: count(row?.collecting_channels),
    limitedChannels: count(row?.limited_channels),
    partialChannels: count(row?.partial_channels),
    blockedChannels: count(row?.blocked_channels),
    focusTotalChannels: count(row?.focus_total_channels),
    focusIngestedChannels: count(row?.focus_ingested_channels),
    focusFailedChannels: count(row?.focus_failed_channels),
    focusLimitedChannels: count(row?.focus_limited_channels),
    focusPartialChannels: count(row?.focus_partial_channels),
  };
}
