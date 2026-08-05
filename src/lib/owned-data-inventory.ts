/**
 * Pure classification and reporting for the legacy owned-data contamination audit.
 *
 * The database query deliberately returns counts only. No handle, credential,
 * cursor, run detail, raw payload, post text, URL, or media value crosses this
 * boundary. See scripts/audit-owned-contamination.ts for the read-only executor.
 */

export const SHARING_SCOPES = [
  'untracked',
  'single_landscape',
  'multiple_landscapes_one_org',
  'shared_across_orgs',
] as const;

export type SharingScope = typeof SHARING_SCOPES[number];

export interface SchemaColumnRow {
  table_name: unknown;
  column_name: unknown;
}

export const INVENTORY_COUNT_FIELDS = [
  'channels_count',
  'legacy_owned_channels',
  'cursor_channels',
  'meta_channels',
  'runs_count',
  'observation_runs',
  'orphan_runs',
  'run_platform_mismatches',
  'runs_with_error',
  'runs_with_detail',
  'posts_count',
  'posts_without_run_provenance',
  'posts_on_legacy_owned_channels',
  'post_platform_mismatches',
  'posts_with_raw',
  'posts_with_saves',
  'posts_with_views',
  'posts_with_media_url',
  'posts_with_thumbnail_url',
  'post_snapshots_count',
  'post_snapshots_on_legacy_owned_channels',
  'post_snapshots_with_saves',
  'post_snapshots_with_views',
  'audience_snapshots_count',
  'audience_snapshots_on_legacy_owned_channels',
  'audience_snapshots_with_following',
  'audience_snapshots_with_extra',
] as const;

type CountField = typeof INVENTORY_COUNT_FIELDS[number];

export type LegacyContaminationAggregateRow = {
  platform: unknown;
  sharing_scope: unknown;
} & Record<CountField, unknown>;

export type FindingCategory =
  | 'known_owner_signal'
  | 'ambiguous_provenance'
  | 'private_or_unreviewed_field';

export interface InventoryFinding {
  code: string;
  category: FindingCategory;
  table: 'channels' | 'ingestion_runs' | 'posts' | 'post_metric_snapshots' | 'audience_snapshots';
  field: string;
  rows: number;
  explanation: string;
}

export interface InventoryGroup {
  platform: string;
  sharingScope: SharingScope;
  sharedAcrossOrgs: boolean;
  channelCount: number;
  findings: InventoryFinding[];
}

export interface SchemaFinding {
  code: 'missing_table' | 'missing_column' | 'unclassified_column';
  table: string;
  column: string | null;
  explanation: string;
}

export interface LegacyContaminationReport {
  generatedAt: string;
  verdict: 'pass' | 'blocked';
  blocked: boolean;
  summary: {
    groups: number;
    channels: number;
    runs: number;
    posts: number;
    postMetricSnapshots: number;
    audienceSnapshots: number;
    findingSignals: number;
    schemaFindings: number;
  };
  schemaFindings: SchemaFinding[];
  groups: InventoryGroup[];
  limitations: readonly string[];
}

/**
 * Every current column in a global table is named here. A new column is a
 * release-blocking unknown until this audit and the isolation policy classify it.
 */
export const EXPECTED_GLOBAL_SCHEMA_COLUMNS = {
  channels: [
    'id', 'company_id', 'platform', 'handle', 'identity_key', 'external_id',
    'profile_url', 'avatar_url', 'is_owned', 'active', 'last_ingested_at',
    'cursor', 'meta', 'created_at',
  ],
  ingestion_runs: [
    'id', 'channel_id', 'platform', 'status', 'started_at', 'finished_at',
    'posts_upserted', 'snapshots_upserted', 'api_calls', 'error', 'detail',
    'source_key', 'visibility',
  ],
  posts: [
    'id', 'channel_id', 'company_id', 'platform', 'external_id', 'posted_at',
    'type', 'text', 'permalink', 'media_url', 'thumbnail_url', 'duration_sec',
    'language', 'hashtags', 'mentions', 'applause', 'conversation',
    'amplification', 'saves', 'views', 'engagement_total',
    'engagement_rate_by_follower', 'engagement_rate_by_view',
    'followers_at_post', 'raw', 'first_seen_at', 'last_refreshed_at',
    'source_run_id', 'visibility',
  ],
  post_metric_snapshots: [
    'post_id', 'captured_at', 'applause', 'conversation', 'amplification',
    'saves', 'views', 'engagement_total', 'source_run_id', 'visibility',
  ],
  audience_snapshots: [
    'channel_id', 'day', 'followers', 'following', 'extra', 'captured_at',
    'source_run_id', 'visibility',
  ],
} as const;

/** Supporting columns used only to classify current landscape sharing. */
export const REQUIRED_SUPPORT_SCHEMA_COLUMNS = {
  landscapes: ['id', 'org_id'],
  landscape_companies: ['landscape_id', 'company_id'],
} as const;

export const INVENTORY_LIMITATIONS = [
  'The inventory reads aggregate presence/count signals only; it never inspects or prints raw payload, cursor, run-detail, post-text, media, handle, or credential contents.',
  'Legacy writes have no trustworthy source-run/visibility link, so every existing run, post, post-metric snapshot, and audience snapshot is classified as provenance-ambiguous until quarantined or re-collected.',
  'Sharing is derived from current landscape membership. It cannot reconstruct which organizations shared a channel when a historical write occurred.',
  'Nonzero and non-null field signals cannot detect owner-derived values that were stored as zero/null, overwritten later, or normalized into another metric.',
  'The command does not prove vendor contract compliance, infer ownership, inspect encrypted credentials, repair rows, quarantine rows, or mutate collection state.',
] as const;

/** Only these platforms currently have a reviewed public-comparable view count. */
const PUBLIC_VIEW_PLATFORMS = new Set(['instagram', 'youtube', 'tiktok']);

/** Deliberately duplicated from the current enum so a new value needs policy review. */
const CLASSIFIED_PLATFORMS = new Set([
  'facebook', 'instagram', 'twitter', 'youtube', 'tiktok',
  'linkedin', 'bluesky', 'threads', 'reddit', 'rss',
]);

function safeString(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error('Invalid legacy-contamination result: ' + label + ' must be a non-empty string.');
  }
  return value;
}

function safeCount(value: unknown, label: string): number {
  const parsed = typeof value === 'bigint'
    ? Number(value)
    : typeof value === 'number'
      ? value
      : typeof value === 'string' && /^\d+$/.test(value)
        ? Number(value)
        : Number.NaN;
  if (!Number.isSafeInteger(parsed) || parsed < 0) {
    throw new Error('Invalid legacy-contamination result: ' + label + ' must be a safe non-negative integer.');
  }
  return parsed;
}

function sharingScope(value: unknown): SharingScope {
  const scope = safeString(value, 'sharing_scope');
  if (!(SHARING_SCOPES as readonly string[]).includes(scope)) {
    throw new Error('Invalid legacy-contamination result: unknown sharing_scope "' + scope + '".');
  }
  return scope as SharingScope;
}

function schemaRowsByTable(rows: readonly SchemaColumnRow[]): Map<string, Set<string>> {
  const out = new Map<string, Set<string>>();
  for (const row of rows) {
    const table = safeString(row.table_name, 'schema table_name');
    const column = safeString(row.column_name, 'schema column_name');
    const columns = out.get(table) ?? new Set<string>();
    columns.add(column);
    out.set(table, columns);
  }
  return out;
}

/** Fail closed when the database schema differs from the columns classified above. */
export function classifyInventorySchema(rows: readonly SchemaColumnRow[]): SchemaFinding[] {
  const actual = schemaRowsByTable(rows);
  const findings: SchemaFinding[] = [];

  for (const [table, expectedColumns] of Object.entries(EXPECTED_GLOBAL_SCHEMA_COLUMNS)) {
    const columns = actual.get(table);
    if (!columns) {
      findings.push({
        code: 'missing_table',
        table,
        column: null,
        explanation: 'Expected global table is absent; the inventory cannot prove its legacy-data status.',
      });
      continue;
    }
    const expected = new Set<string>(expectedColumns);
    for (const column of expected) {
      if (!columns.has(column)) {
        findings.push({
          code: 'missing_column',
          table,
          column,
          explanation: 'Expected classified column is absent; code and database schema are out of sync.',
        });
      }
    }
    for (const column of columns) {
      if (!expected.has(column)) {
        findings.push({
          code: 'unclassified_column',
          table,
          column,
          explanation: 'Global column has no owned/public isolation classification and defaults to private.',
        });
      }
    }
  }

  for (const [table, requiredColumns] of Object.entries(REQUIRED_SUPPORT_SCHEMA_COLUMNS)) {
    const columns = actual.get(table);
    if (!columns) {
      findings.push({
        code: 'missing_table',
        table,
        column: null,
        explanation: 'Sharing-support table is absent; cross-organization exposure cannot be classified.',
      });
      continue;
    }
    for (const column of requiredColumns) {
      if (!columns.has(column)) {
        findings.push({
          code: 'missing_column',
          table,
          column,
          explanation: 'Sharing-support column is absent; cross-organization exposure cannot be classified.',
        });
      }
    }
  }

  return findings.sort((a, b) =>
    a.table.localeCompare(b.table)
      || (a.column ?? '').localeCompare(b.column ?? '')
      || a.code.localeCompare(b.code));
}

function addFinding(
  findings: InventoryFinding[],
  rows: number,
  finding: Omit<InventoryFinding, 'rows'>,
): void {
  if (rows === 0) return;
  findings.push({ ...finding, rows });
}

function classifyGroup(
  platform: string,
  counts: Record<CountField, number>,
): InventoryFinding[] {
  const findings: InventoryFinding[] = [];
  const add = (field: CountField, finding: Omit<InventoryFinding, 'rows'>): void =>
    addFinding(findings, counts[field], finding);

  if (!CLASSIFIED_PLATFORMS.has(platform)) {
    const rows = Math.max(
      counts.channels_count,
      counts.runs_count,
      counts.posts_count,
      counts.post_snapshots_count,
      counts.audience_snapshots_count,
    );
    addFinding(findings, rows, {
      code: 'unclassified_platform',
      category: 'private_or_unreviewed_field',
      table: counts.channels_count > 0 ? 'channels' : 'ingestion_runs',
      field: 'platform',
      explanation: 'Platform has no reviewed public/private field classification and defaults to private.',
    });
  }

  add('legacy_owned_channels', {
    code: 'legacy_owned_channel',
    category: 'known_owner_signal',
    table: 'channels',
    field: 'is_owned',
    explanation: 'A global channel still carries the legacy owner flag; every observation on it requires public re-collection or quarantine.',
  });
  add('cursor_channels', {
    code: 'mixed_source_cursor',
    category: 'ambiguous_provenance',
    table: 'channels',
    field: 'cursor',
    explanation: 'The global cursor has no source key or visibility boundary. Only its non-empty presence was counted.',
  });
  add('meta_channels', {
    code: 'unreviewed_channel_metadata',
    category: 'ambiguous_provenance',
    table: 'channels',
    field: 'meta',
    explanation: 'Global channel metadata is non-empty and has no field allowlist/provenance. Its contents were not read.',
  });
  add('runs_count', {
    code: 'run_missing_source_visibility',
    category: 'ambiguous_provenance',
    table: 'ingestion_runs',
    field: 'source_key, visibility, org_id, credential_connection_id, owned_binding_id',
    explanation: 'Legacy run rows do not record the source, visibility, organization, credential connection, or owned binding needed to prove a public write.',
  });
  add('observation_runs', {
    code: 'ambiguous_observation_writing_run',
    category: 'ambiguous_provenance',
    table: 'ingestion_runs',
    field: 'posts_upserted, snapshots_upserted',
    explanation: 'Run reports global observation writes but lacks trustworthy source and visibility provenance.',
  });
  add('orphan_runs', {
    code: 'run_without_channel',
    category: 'ambiguous_provenance',
    table: 'ingestion_runs',
    field: 'channel_id',
    explanation: 'Run has no channel, so its sharing scope and observation lineage cannot be established.',
  });
  add('run_platform_mismatches', {
    code: 'run_channel_platform_mismatch',
    category: 'ambiguous_provenance',
    table: 'ingestion_runs',
    field: 'platform',
    explanation: 'Run platform differs from its channel platform and requires operator reconciliation.',
  });
  add('runs_with_error', {
    code: 'global_run_error_text',
    category: 'ambiguous_provenance',
    table: 'ingestion_runs',
    field: 'error',
    explanation: 'Legacy run stores error text without a visibility/retention boundary. Only non-null presence was counted.',
  });
  add('runs_with_detail', {
    code: 'global_run_detail',
    category: 'ambiguous_provenance',
    table: 'ingestion_runs',
    field: 'detail',
    explanation: 'Legacy run detail is non-empty without a public field allowlist. Its contents were not read.',
  });
  add('posts_without_run_provenance', {
    code: 'post_missing_source_run',
    category: 'ambiguous_provenance',
    table: 'posts',
    field: 'source_run_id, visibility',
    explanation: 'Global post has no source-run or visibility link, so its origin cannot be proven public.',
  });
  add('posts_on_legacy_owned_channels', {
    code: 'post_on_legacy_owned_channel',
    category: 'known_owner_signal',
    table: 'posts',
    field: '*',
    explanation: 'Global post belongs to a channel carrying the legacy owner flag.',
  });
  add('post_platform_mismatches', {
    code: 'post_channel_platform_mismatch',
    category: 'ambiguous_provenance',
    table: 'posts',
    field: 'platform',
    explanation: 'Post platform differs from its channel platform and requires operator reconciliation.',
  });
  add('posts_with_raw', {
    code: 'global_raw_post_payload',
    category: 'private_or_unreviewed_field',
    table: 'posts',
    field: 'raw',
    explanation: 'Global post retains a raw payload with no public field allowlist. Only non-null presence was counted.',
  });
  add('posts_with_saves', {
    code: 'global_post_saves',
    category: 'private_or_unreviewed_field',
    table: 'posts',
    field: 'saves',
    explanation: 'Nonzero saves/bookmarks are owner-only, restricted, or unreviewed for pooled competitive use.',
  });
  add('posts_with_saves', {
    code: 'post_metrics_derived_from_saves',
    category: 'private_or_unreviewed_field',
    table: 'posts',
    field: 'engagement_total, engagement_rate_by_follower, engagement_rate_by_view',
    explanation: 'Rows with nonzero saves may have contaminated engagement totals and derived rates and must be recomputed.',
  });
  if (!PUBLIC_VIEW_PLATFORMS.has(platform)) {
    add('posts_with_views', {
      code: 'unreviewed_global_post_views',
      category: 'private_or_unreviewed_field',
      table: 'posts',
      field: 'views',
      explanation: 'Nonzero views are not on the reviewed public-comparable allowlist for this platform.',
    });
  }
  if (platform === 'instagram') {
    add('posts_with_media_url', {
      code: 'instagram_media_url_without_provenance',
      category: 'private_or_unreviewed_field',
      table: 'posts',
      field: 'media_url',
      explanation: 'Instagram media reference may be owner-signed; the URL value was not inspected.',
    });
    add('posts_with_thumbnail_url', {
      code: 'instagram_thumbnail_url_without_provenance',
      category: 'private_or_unreviewed_field',
      table: 'posts',
      field: 'thumbnail_url',
      explanation: 'Instagram thumbnail reference may be owner-signed; the URL value was not inspected.',
    });
  }
  add('post_snapshots_count', {
    code: 'post_snapshot_missing_source_run',
    category: 'ambiguous_provenance',
    table: 'post_metric_snapshots',
    field: 'source_run_id, visibility',
    explanation: 'Global metric snapshot has no source-run or visibility link, so its origin cannot be proven public.',
  });
  add('post_snapshots_on_legacy_owned_channels', {
    code: 'post_snapshot_on_legacy_owned_channel',
    category: 'known_owner_signal',
    table: 'post_metric_snapshots',
    field: '*',
    explanation: 'Global metric snapshot belongs to a channel carrying the legacy owner flag.',
  });
  add('post_snapshots_with_saves', {
    code: 'global_snapshot_saves',
    category: 'private_or_unreviewed_field',
    table: 'post_metric_snapshots',
    field: 'saves',
    explanation: 'Nonzero snapshot saves/bookmarks are owner-only, restricted, or unreviewed for pooled use.',
  });
  add('post_snapshots_with_saves', {
    code: 'snapshot_engagement_derived_from_saves',
    category: 'private_or_unreviewed_field',
    table: 'post_metric_snapshots',
    field: 'engagement_total',
    explanation: 'Snapshot engagement totals on rows with saves may include a private/unreviewed component.',
  });
  if (!PUBLIC_VIEW_PLATFORMS.has(platform)) {
    add('post_snapshots_with_views', {
      code: 'unreviewed_global_snapshot_views',
      category: 'private_or_unreviewed_field',
      table: 'post_metric_snapshots',
      field: 'views',
      explanation: 'Nonzero snapshot views are not on the reviewed public-comparable allowlist for this platform.',
    });
  }
  add('audience_snapshots_count', {
    code: 'audience_snapshot_missing_source_run',
    category: 'ambiguous_provenance',
    table: 'audience_snapshots',
    field: 'source_run_id, visibility',
    explanation: 'Global audience snapshot has no source-run or visibility link, so its origin cannot be proven public.',
  });
  add('audience_snapshots_on_legacy_owned_channels', {
    code: 'audience_snapshot_on_legacy_owned_channel',
    category: 'known_owner_signal',
    table: 'audience_snapshots',
    field: '*',
    explanation: 'Global audience snapshot belongs to a channel carrying the legacy owner flag.',
  });
  add('audience_snapshots_with_following', {
    code: 'global_audience_following',
    category: 'private_or_unreviewed_field',
    table: 'audience_snapshots',
    field: 'following',
    explanation: 'Following counts are not on the reviewed pooled public field allowlist for every platform.',
  });
  add('audience_snapshots_with_extra', {
    code: 'unreviewed_audience_extra',
    category: 'private_or_unreviewed_field',
    table: 'audience_snapshots',
    field: 'extra',
    explanation: 'Platform-specific audience extras are non-empty and have no field-level provenance. Contents were not read.',
  });

  if (platform === 'linkedin') {
    add('posts_count', {
      code: 'linkedin_global_posts_unapproved',
      category: 'private_or_unreviewed_field',
      table: 'posts',
      field: '*',
      explanation: 'LinkedIn global post observations require policy approval or public re-collection; legacy rows may contain administrator data.',
    });
    add('post_snapshots_count', {
      code: 'linkedin_global_snapshots_unapproved',
      category: 'private_or_unreviewed_field',
      table: 'post_metric_snapshots',
      field: '*',
      explanation: 'LinkedIn global metric snapshots may contain administrator statistics and are not approved as pooled public data.',
    });
    add('audience_snapshots_count', {
      code: 'linkedin_global_audience_unapproved',
      category: 'private_or_unreviewed_field',
      table: 'audience_snapshots',
      field: '*',
      explanation: 'LinkedIn global audience snapshots lack approved public provenance.',
    });
  }

  return findings.sort((a, b) =>
    a.table.localeCompare(b.table)
      || a.field.localeCompare(b.field)
      || a.code.localeCompare(b.code));
}

function normalizeAggregateRow(row: LegacyContaminationAggregateRow): {
  platform: string;
  sharingScope: SharingScope;
  counts: Record<CountField, number>;
} {
  const platform = safeString(row.platform, 'platform');
  const scope = sharingScope(row.sharing_scope);
  const counts = {} as Record<CountField, number>;
  for (const field of INVENTORY_COUNT_FIELDS) {
    counts[field] = safeCount(row[field], platform + '/' + scope + '/' + field);
  }
  if (counts.posts_without_run_provenance !== counts.posts_count) {
    throw new Error('Invalid legacy-contamination result: every post must be counted in the provenance check.');
  }
  return { platform, sharingScope: scope, counts };
}

export function summarizeLegacyContamination(
  aggregateRows: readonly LegacyContaminationAggregateRow[],
  schemaRows: readonly SchemaColumnRow[],
  generatedAt: string,
): LegacyContaminationReport {
  if (Number.isNaN(Date.parse(generatedAt))) {
    throw new Error('Invalid legacy-contamination report timestamp.');
  }

  const schemaFindings = classifyInventorySchema(schemaRows);
  const groups: InventoryGroup[] = [];
  const seen = new Set<string>();
  let channels = 0;
  let runs = 0;
  let posts = 0;
  let postMetricSnapshots = 0;
  let audienceSnapshots = 0;

  for (const rawRow of aggregateRows) {
    const row = normalizeAggregateRow(rawRow);
    const key = row.platform + '\u0000' + row.sharingScope;
    if (seen.has(key)) {
      throw new Error('Invalid legacy-contamination result: duplicate group ' + row.platform + '/' + row.sharingScope + '.');
    }
    seen.add(key);
    const findings = classifyGroup(row.platform, row.counts);
    channels += row.counts.channels_count;
    runs += row.counts.runs_count;
    posts += row.counts.posts_count;
    postMetricSnapshots += row.counts.post_snapshots_count;
    audienceSnapshots += row.counts.audience_snapshots_count;
    groups.push({
      platform: row.platform,
      sharingScope: row.sharingScope,
      sharedAcrossOrgs: row.sharingScope === 'shared_across_orgs',
      channelCount: row.counts.channels_count,
      findings,
    });
  }

  const scopeOrder = new Map<string, number>(SHARING_SCOPES.map((scope, index) => [scope, index]));
  groups.sort((a, b) =>
    a.platform.localeCompare(b.platform)
      || (scopeOrder.get(a.sharingScope) ?? 99) - (scopeOrder.get(b.sharingScope) ?? 99));
  const findingSignals = groups.reduce((sum, group) => sum + group.findings.length, 0);
  const blocked = schemaFindings.length > 0 || findingSignals > 0;

  return {
    generatedAt: new Date(generatedAt).toISOString(),
    verdict: blocked ? 'blocked' : 'pass',
    blocked,
    summary: {
      groups: groups.length,
      channels,
      runs,
      posts,
      postMetricSnapshots,
      audienceSnapshots,
      findingSignals,
      schemaFindings: schemaFindings.length,
    },
    schemaFindings,
    groups,
    limitations: INVENTORY_LIMITATIONS,
  };
}

/**
 * Schema names only. Values from the global tables are never selected here.
 */
export const INVENTORY_SCHEMA_QUERY = `
SELECT table_name, column_name
  FROM information_schema.columns
 WHERE table_schema = current_schema()
   AND table_name IN (
     'channels',
     'ingestion_runs',
     'posts',
     'post_metric_snapshots',
     'audience_snapshots',
     'landscapes',
     'landscape_companies'
   )
 ORDER BY table_name, ordinal_position
`;

/**
 * Aggregate-only inventory. Sensitive JSON/text values are tested for presence
 * but never selected, grouped, serialized, or printed.
 */
export const LEGACY_CONTAMINATION_QUERY = `
WITH channel_scope AS (
  SELECT channel.id AS channel_id,
         channel.platform::text AS platform,
         channel.is_owned AS legacy_owned,
         CASE
           WHEN tracking.org_count > 1 THEN 'shared_across_orgs'
           WHEN tracking.landscape_count > 1 THEN 'multiple_landscapes_one_org'
           WHEN tracking.landscape_count = 1 THEN 'single_landscape'
           ELSE 'untracked'
         END AS sharing_scope,
         (
           jsonb_typeof(channel.cursor) IS DISTINCT FROM 'object'
           OR channel.cursor <> '{}'::jsonb
         ) AS has_cursor,
         (
           jsonb_typeof(channel.meta) IS DISTINCT FROM 'object'
           OR channel.meta <> '{}'::jsonb
         ) AS has_meta
    FROM channels channel
    LEFT JOIN LATERAL (
      SELECT count(DISTINCT member.landscape_id)::integer AS landscape_count,
             count(DISTINCT landscape.org_id)::integer AS org_count
        FROM landscape_companies member
        JOIN landscapes landscape ON landscape.id = member.landscape_id
       WHERE member.company_id = channel.company_id
    ) tracking ON true
), group_keys AS (
  SELECT DISTINCT platform, sharing_scope FROM channel_scope
  UNION
  SELECT DISTINCT run.platform::text, 'untracked'
    FROM ingestion_runs run
   WHERE run.channel_id IS NULL
), channel_counts AS (
  SELECT platform,
         sharing_scope,
         count(*) AS channels_count,
         count(*) FILTER (WHERE legacy_owned) AS legacy_owned_channels,
         count(*) FILTER (WHERE has_cursor) AS cursor_channels,
         count(*) FILTER (WHERE has_meta) AS meta_channels
    FROM channel_scope
   GROUP BY platform, sharing_scope
), run_counts AS (
  SELECT coalesce(scope.platform, run.platform::text) AS platform,
         coalesce(scope.sharing_scope, 'untracked') AS sharing_scope,
         count(*) AS runs_count,
         count(*) FILTER (
           WHERE run.posts_upserted > 0 OR run.snapshots_upserted > 0
         ) AS observation_runs,
         count(*) FILTER (WHERE run.channel_id IS NULL) AS orphan_runs,
         count(*) FILTER (
           WHERE scope.platform IS NOT NULL
             AND run.platform::text <> scope.platform
         ) AS run_platform_mismatches,
         count(*) FILTER (WHERE run.error IS NOT NULL) AS runs_with_error,
         count(*) FILTER (
           WHERE jsonb_typeof(run.detail) IS DISTINCT FROM 'object'
             OR run.detail <> '{}'::jsonb
         ) AS runs_with_detail
    FROM ingestion_runs run
    LEFT JOIN channel_scope scope ON scope.channel_id = run.channel_id
   GROUP BY coalesce(scope.platform, run.platform::text),
            coalesce(scope.sharing_scope, 'untracked')
), post_counts AS (
  SELECT scope.platform,
         scope.sharing_scope,
         count(*) AS posts_count,
         count(*) AS posts_without_run_provenance,
         count(*) FILTER (WHERE scope.legacy_owned) AS posts_on_legacy_owned_channels,
         count(*) FILTER (WHERE post.platform::text <> scope.platform) AS post_platform_mismatches,
         count(*) FILTER (WHERE post.raw IS NOT NULL) AS posts_with_raw,
         count(*) FILTER (WHERE post.saves <> 0) AS posts_with_saves,
         count(*) FILTER (WHERE post.views <> 0) AS posts_with_views,
         count(*) FILTER (WHERE post.media_url IS NOT NULL) AS posts_with_media_url,
         count(*) FILTER (WHERE post.thumbnail_url IS NOT NULL) AS posts_with_thumbnail_url
    FROM posts post
    JOIN channel_scope scope ON scope.channel_id = post.channel_id
   GROUP BY scope.platform, scope.sharing_scope
), post_snapshot_counts AS (
  SELECT scope.platform,
         scope.sharing_scope,
         count(*) AS post_snapshots_count,
         count(*) FILTER (WHERE scope.legacy_owned) AS post_snapshots_on_legacy_owned_channels,
         count(*) FILTER (WHERE snapshot.saves <> 0) AS post_snapshots_with_saves,
         count(*) FILTER (WHERE snapshot.views <> 0) AS post_snapshots_with_views
    FROM post_metric_snapshots snapshot
    JOIN posts post ON post.id = snapshot.post_id
    JOIN channel_scope scope ON scope.channel_id = post.channel_id
   GROUP BY scope.platform, scope.sharing_scope
), audience_snapshot_counts AS (
  SELECT scope.platform,
         scope.sharing_scope,
         count(*) AS audience_snapshots_count,
         count(*) FILTER (WHERE scope.legacy_owned) AS audience_snapshots_on_legacy_owned_channels,
         count(*) FILTER (WHERE snapshot.following IS NOT NULL) AS audience_snapshots_with_following,
         count(*) FILTER (
           WHERE jsonb_typeof(snapshot.extra) IS DISTINCT FROM 'object'
             OR snapshot.extra <> '{}'::jsonb
         ) AS audience_snapshots_with_extra
    FROM audience_snapshots snapshot
    JOIN channel_scope scope ON scope.channel_id = snapshot.channel_id
   GROUP BY scope.platform, scope.sharing_scope
)
SELECT key.platform,
       key.sharing_scope,
       coalesce(channel.channels_count, 0)::text AS channels_count,
       coalesce(channel.legacy_owned_channels, 0)::text AS legacy_owned_channels,
       coalesce(channel.cursor_channels, 0)::text AS cursor_channels,
       coalesce(channel.meta_channels, 0)::text AS meta_channels,
       coalesce(run.runs_count, 0)::text AS runs_count,
       coalesce(run.observation_runs, 0)::text AS observation_runs,
       coalesce(run.orphan_runs, 0)::text AS orphan_runs,
       coalesce(run.run_platform_mismatches, 0)::text AS run_platform_mismatches,
       coalesce(run.runs_with_error, 0)::text AS runs_with_error,
       coalesce(run.runs_with_detail, 0)::text AS runs_with_detail,
       coalesce(post.posts_count, 0)::text AS posts_count,
       coalesce(post.posts_without_run_provenance, 0)::text AS posts_without_run_provenance,
       coalesce(post.posts_on_legacy_owned_channels, 0)::text AS posts_on_legacy_owned_channels,
       coalesce(post.post_platform_mismatches, 0)::text AS post_platform_mismatches,
       coalesce(post.posts_with_raw, 0)::text AS posts_with_raw,
       coalesce(post.posts_with_saves, 0)::text AS posts_with_saves,
       coalesce(post.posts_with_views, 0)::text AS posts_with_views,
       coalesce(post.posts_with_media_url, 0)::text AS posts_with_media_url,
       coalesce(post.posts_with_thumbnail_url, 0)::text AS posts_with_thumbnail_url,
       coalesce(metric.post_snapshots_count, 0)::text AS post_snapshots_count,
       coalesce(metric.post_snapshots_on_legacy_owned_channels, 0)::text AS post_snapshots_on_legacy_owned_channels,
       coalesce(metric.post_snapshots_with_saves, 0)::text AS post_snapshots_with_saves,
       coalesce(metric.post_snapshots_with_views, 0)::text AS post_snapshots_with_views,
       coalesce(audience.audience_snapshots_count, 0)::text AS audience_snapshots_count,
       coalesce(audience.audience_snapshots_on_legacy_owned_channels, 0)::text AS audience_snapshots_on_legacy_owned_channels,
       coalesce(audience.audience_snapshots_with_following, 0)::text AS audience_snapshots_with_following,
       coalesce(audience.audience_snapshots_with_extra, 0)::text AS audience_snapshots_with_extra
  FROM group_keys key
  LEFT JOIN channel_counts channel USING (platform, sharing_scope)
  LEFT JOIN run_counts run USING (platform, sharing_scope)
  LEFT JOIN post_counts post USING (platform, sharing_scope)
  LEFT JOIN post_snapshot_counts metric USING (platform, sharing_scope)
  LEFT JOIN audience_snapshot_counts audience USING (platform, sharing_scope)
 ORDER BY key.platform, key.sharing_scope
`;
