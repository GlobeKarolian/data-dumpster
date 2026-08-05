import type { Metadata } from 'next';
import type { Platform } from '@/lib/types';
import type { CollectionOutcome } from '@/lib/adapters/types';
import { SourcesManager, type CompanySources } from '@/components/settings/sources-manager';
import { CoverageStrip } from '@/components/settings/coverage-strip';
import { recentCoverage, type DayCoverage } from '@/lib/metrics/daily-coverage';
import { NoLandscape } from '@/components/common/no-landscape';
import { query, type SearchParamsInput } from '../../_lib/data';
import { resolveContext } from '../../_lib/context';

export const metadata: Metadata = { title: 'Social Profiles' };

type SourceRow = {
  company_id: string;
  company_name: string;
  attributed_to_org: boolean;
  channel_id: string | null;
  platform: Platform | null;
  handle: string | null;
  profile_url: string | null;
  active: boolean | null;
  last_ingested_at: string | null;
  last_run_status: string | null;
  last_run_error: string | null;
  collection_status: 'queued' | 'running' | 'succeeded' | 'partial' | 'failed' | null;
  collection_outcome: CollectionOutcome | null;
  collection_required_since: string | null;
  collection_required_until: string | null;
  collection_coverage_since: string | null;
  collection_coverage_until: string | null;
  collection_attempts: number | string | null;
  collection_next_attempt_at: string | null;
  collection_lease_until: string | null;
  collection_has_more: boolean | null;
  collection_last_error: string | null;
  collection_updated_at: string | null;
  post_count: number | string | null;
};

export default async function SourcesPage({
  searchParams,
}: {
  searchParams: Promise<SearchParamsInput>;
}) {
  const ctx = await resolveContext(await searchParams);
  const landscape = ctx.landscape;
  if (!landscape) return <NoLandscape reason={ctx.error} />;

  // Never let a coverage-panel failure take the whole page down: the profile
  // list is the reason someone came here.
  let coverage: DayCoverage[] = [];
  try {
    coverage = await recentCoverage(14);
  } catch {
    coverage = [];
  }

  const rows = await query<SourceRow>(({ sql }) => sql`
    SELECT c.id   AS company_id,
           c.name AS company_name,
           (c.org_id = ${ctx.orgId}::uuid) AS attributed_to_org,
           ch.id  AS channel_id,
           ch.platform,
           ch.handle,
           ch.profile_url,
           ch.active,
           ch.last_ingested_at,
           run.status AS last_run_status,
           run.error  AS last_run_error,
           CASE
             WHEN demand.channel_id IS NULL THEN NULL
             WHEN state.coverage_since <= demand.required_since
               AND state.coverage_until >= demand.required_until
               THEN 'succeeded'::ingest_status
             ELSE state.status
           END AS collection_status,
           CASE
             WHEN demand.channel_id IS NULL THEN NULL
             WHEN state.coverage_since <= demand.required_since
               AND state.coverage_until >= demand.required_until
               THEN 'certified_complete'::collection_outcome
             ELSE state.outcome
           END AS collection_outcome,
           demand.required_since AS collection_required_since,
           demand.required_until AS collection_required_until,
           state.coverage_since AS collection_coverage_since,
           state.coverage_until AS collection_coverage_until,
           state.attempts AS collection_attempts,
           CASE
             WHEN state.coverage_since <= demand.required_since
               AND state.coverage_until >= demand.required_until
               THEN NULL
             ELSE state.next_attempt_at
           END AS collection_next_attempt_at,
           state.lease_until AS collection_lease_until,
           CASE
             WHEN state.coverage_since <= demand.required_since
               AND state.coverage_until >= demand.required_until
               THEN false
             ELSE state.has_more
           END AS collection_has_more,
           CASE
             WHEN state.coverage_since <= demand.required_since
               AND state.coverage_until >= demand.required_until
               THEN NULL
             ELSE state.last_error
           END AS collection_last_error,
           state.updated_at AS collection_updated_at,
           (SELECT count(*) FROM posts p WHERE p.channel_id = ch.id) AS post_count
      FROM landscapes selected_l
      JOIN landscape_companies lc
        ON lc.landscape_id = selected_l.id
      JOIN companies c
        ON c.id = lc.company_id
      LEFT JOIN channels ch ON ch.company_id = c.id
      LEFT JOIN landscape_channel_demands demand
        ON demand.landscape_id = selected_l.id
       AND demand.channel_id = ch.id
      LEFT JOIN channel_collection_state state ON state.channel_id = ch.id
      LEFT JOIN LATERAL (
        SELECT r.status, r.error
          FROM ingestion_runs r
         WHERE r.channel_id = ch.id
         ORDER BY r.started_at DESC
         LIMIT 1
      ) run ON true
     WHERE selected_l.id = ${landscape.id}::uuid
       AND selected_l.org_id = ${ctx.orgId}::uuid
     ORDER BY lc.sort_order ASC, c.name ASC, ch.platform ASC
  `);

  const byCompany = new Map<string, CompanySources>();
  for (const row of rows.data) {
    const entry = byCompany.get(row.company_id) ?? {
      id: row.company_id,
      name: row.company_name,
      manageable: row.attributed_to_org === true,
      channels: [],
    };
    if (row.channel_id && row.platform && row.handle) {
      entry.channels.push({
        id: row.channel_id,
        platform: row.platform,
        handle: row.handle,
        profileUrl: row.profile_url,
        active: row.active ?? true,
        lastIngestedAt: row.last_ingested_at,
        lastRunStatus: row.last_run_status,
        lastRunError: row.last_run_error,
        collectionStatus: row.collection_status,
        collectionOutcome: row.collection_outcome,
        collectionRequiredSince: row.collection_required_since,
        collectionRequiredUntil: row.collection_required_until,
        collectionCoverageSince: row.collection_coverage_since,
        collectionCoverageUntil: row.collection_coverage_until,
        collectionAttempts: Number(row.collection_attempts) || 0,
        collectionNextAttemptAt: row.collection_next_attempt_at,
        collectionLeaseUntil: row.collection_lease_until,
        collectionHasMore: row.collection_has_more,
        collectionLastError: row.collection_last_error,
        collectionUpdatedAt: row.collection_updated_at,
        postCount: Number(row.post_count) || 0,
      });
    }
    byCompany.set(row.company_id, entry);
  }

  return (
    <div className="mx-auto max-w-5xl space-y-4">
      <div>
        <h2 className="text-base font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
          Social profiles
        </h2>
        <p className="mt-1 max-w-3xl text-sm leading-relaxed text-zinc-600 dark:text-zinc-400">
          Add and manage the accounts in {landscape.name}. A profile can report useful recent data
          while its older history remains partial; Data Dumpster labels that distinction instead of
          turning missing history into zero.
        </p>
      </div>

      {ctx.error || rows.error ? (
        <p className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700 dark:border-red-900/50 dark:bg-red-950/30 dark:text-red-400">
          {'Channels could not be read: ' + (rows.error ?? ctx.error)}
        </p>
      ) : null}

      <CoverageStrip days={coverage} />

      <SourcesManager companies={[...byCompany.values()]} landscapeName={landscape.name} />
    </div>
  );
}
