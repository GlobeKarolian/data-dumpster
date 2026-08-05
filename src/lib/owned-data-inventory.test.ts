import assert from 'node:assert/strict';
import test from 'node:test';
import {
  EXPECTED_GLOBAL_SCHEMA_COLUMNS,
  INVENTORY_COUNT_FIELDS,
  INVENTORY_SCHEMA_QUERY,
  LEGACY_CONTAMINATION_QUERY,
  REQUIRED_SUPPORT_SCHEMA_COLUMNS,
  classifyInventorySchema,
  summarizeLegacyContamination,
  type LegacyContaminationAggregateRow,
  type SchemaColumnRow,
} from './owned-data-inventory';

function currentSchemaRows(): SchemaColumnRow[] {
  return [
    ...Object.entries(EXPECTED_GLOBAL_SCHEMA_COLUMNS),
    ...Object.entries(REQUIRED_SUPPORT_SCHEMA_COLUMNS),
  ].flatMap(([table, columns]) =>
    columns.map((column) => ({ table_name: table, column_name: column })));
}

function aggregateRow(
  overrides: Partial<LegacyContaminationAggregateRow> = {},
): LegacyContaminationAggregateRow {
  const counts = Object.fromEntries(INVENTORY_COUNT_FIELDS.map((field) => [field, '0']));
  return {
    platform: 'youtube',
    sharing_scope: 'single_landscape',
    ...counts,
    ...overrides,
  } as LegacyContaminationAggregateRow;
}

function findingCodes(report: ReturnType<typeof summarizeLegacyContamination>): Set<string> {
  return new Set(report.groups.flatMap((group) => group.findings.map((finding) => finding.code)));
}

test('an empty database matching the classified schema passes', () => {
  const report = summarizeLegacyContamination([], currentSchemaRows(), '2026-08-03T12:00:00Z');
  assert.equal(report.verdict, 'pass');
  assert.equal(report.blocked, false);
  assert.deepEqual(report.summary, {
    groups: 0,
    channels: 0,
    runs: 0,
    posts: 0,
    postMetricSnapshots: 0,
    audienceSnapshots: 0,
    findingSignals: 0,
    schemaFindings: 0,
  });
});

test('classifies owner signals and private Instagram fields without payload contents', () => {
  const report = summarizeLegacyContamination([
    aggregateRow({
      platform: 'instagram',
      sharing_scope: 'shared_across_orgs',
      channels_count: '1',
      legacy_owned_channels: '1',
      cursor_channels: '1',
      runs_count: '2',
      observation_runs: '1',
      posts_count: '3',
      posts_without_run_provenance: '3',
      posts_on_legacy_owned_channels: '3',
      posts_with_raw: '2',
      posts_with_saves: '1',
      posts_with_views: '3',
      posts_with_media_url: '2',
      posts_with_thumbnail_url: '1',
      post_snapshots_count: '4',
      post_snapshots_on_legacy_owned_channels: '4',
      post_snapshots_with_saves: '2',
      post_snapshots_with_views: '4',
      audience_snapshots_count: '5',
      audience_snapshots_on_legacy_owned_channels: '5',
      audience_snapshots_with_following: '1',
      audience_snapshots_with_extra: '2',
    }),
  ], currentSchemaRows(), '2026-08-03T12:00:00Z');

  assert.equal(report.verdict, 'blocked');
  assert.equal(report.groups[0]?.sharedAcrossOrgs, true);
  const codes = findingCodes(report);
  assert.ok(codes.has('legacy_owned_channel'));
  assert.ok(codes.has('mixed_source_cursor'));
  assert.ok(codes.has('global_raw_post_payload'));
  assert.ok(codes.has('global_post_saves'));
  assert.ok(codes.has('post_metrics_derived_from_saves'));
  assert.ok(codes.has('instagram_media_url_without_provenance'));
  assert.ok(codes.has('instagram_thumbnail_url_without_provenance'));
  assert.ok(codes.has('post_snapshot_missing_source_run'));
  assert.ok(codes.has('audience_snapshot_missing_source_run'));
  assert.ok(!codes.has('unreviewed_global_post_views'),
    'public vendor Instagram plays remain allowed, while their missing provenance is still blocked');
  assert.ok(!JSON.stringify(report).includes('payload contents'));
});

test('public YouTube views do not add a private-view finding but missing provenance still blocks', () => {
  const report = summarizeLegacyContamination([
    aggregateRow({
      platform: 'youtube',
      channels_count: 1,
      posts_count: 1,
      posts_without_run_provenance: 1,
      posts_with_views: 1,
    }),
  ], currentSchemaRows(), '2026-08-03T12:00:00Z');
  const codes = findingCodes(report);
  assert.equal(report.blocked, true);
  assert.ok(codes.has('post_missing_source_run'));
  assert.ok(!codes.has('unreviewed_global_post_views'));
});

test('restricted X views and every nonzero saves field fail closed', () => {
  const report = summarizeLegacyContamination([
    aggregateRow({
      platform: 'twitter',
      channels_count: '1',
      posts_count: '2',
      posts_without_run_provenance: '2',
      posts_with_views: '1',
      posts_with_saves: '1',
      post_snapshots_count: '1',
      post_snapshots_with_views: '1',
      post_snapshots_with_saves: '1',
    }),
  ], currentSchemaRows(), '2026-08-03T12:00:00Z');
  const codes = findingCodes(report);
  assert.ok(codes.has('unreviewed_global_post_views'));
  assert.ok(codes.has('unreviewed_global_snapshot_views'));
  assert.ok(codes.has('global_post_saves'));
  assert.ok(codes.has('global_snapshot_saves'));
});

test('unknown platforms and run text/json presence default to blocked without reading contents', () => {
  const report = summarizeLegacyContamination([
    aggregateRow({
      platform: 'new_network',
      channels_count: '1',
      runs_count: '1',
      runs_with_error: '1',
      runs_with_detail: '1',
    }),
  ], currentSchemaRows(), '2026-08-03T12:00:00Z');
  const codes = findingCodes(report);
  assert.ok(codes.has('unclassified_platform'));
  assert.ok(codes.has('global_run_error_text'));
  assert.ok(codes.has('global_run_detail'));
});

test('schema drift is deterministic and release-blocking', () => {
  const schema = currentSchemaRows().filter((row) =>
    !(row.table_name === 'channels' && row.column_name === 'identity_key'));
  schema.push({ table_name: 'posts', column_name: 'owner_insight' });
  const findings = classifyInventorySchema(schema);
  assert.deepEqual(
    findings.map((finding) => [finding.code, finding.table, finding.column]),
    [
      ['missing_column', 'channels', 'identity_key'],
      ['unclassified_column', 'posts', 'owner_insight'],
    ],
  );
  const report = summarizeLegacyContamination([], schema, '2026-08-03T12:00:00Z');
  assert.equal(report.verdict, 'blocked');
  assert.equal(report.summary.schemaFindings, 2);
});

test('groups sort deterministically by platform then sharing scope', () => {
  const report = summarizeLegacyContamination([
    aggregateRow({ platform: 'youtube', sharing_scope: 'shared_across_orgs', channels_count: '1' }),
    aggregateRow({ platform: 'instagram', sharing_scope: 'single_landscape', channels_count: '1' }),
    aggregateRow({ platform: 'instagram', sharing_scope: 'untracked', channels_count: '1' }),
  ], currentSchemaRows(), '2026-08-03T12:00:00Z');
  assert.deepEqual(
    report.groups.map((group) => [group.platform, group.sharingScope]),
    [
      ['instagram', 'untracked'],
      ['instagram', 'single_landscape'],
      ['youtube', 'shared_across_orgs'],
    ],
  );
});

test('malformed counts and duplicate groups are rejected instead of under-reporting', () => {
  assert.throws(
    () => summarizeLegacyContamination([
      aggregateRow({ posts_count: '-1' }),
    ], currentSchemaRows(), '2026-08-03T12:00:00Z'),
    /safe non-negative integer/,
  );
  assert.throws(
    () => summarizeLegacyContamination([
      aggregateRow(),
      aggregateRow(),
    ], currentSchemaRows(), '2026-08-03T12:00:00Z'),
    /duplicate group/,
  );
});

test('inventory SQL contains only read operations and aggregate signals', () => {
  for (const query of [INVENTORY_SCHEMA_QUERY, LEGACY_CONTAMINATION_QUERY]) {
    assert.match(query.trimStart(), /^(?:SELECT|WITH)\b/i);
    assert.doesNotMatch(
      query,
      /\b(?:INSERT|UPDATE|DELETE|MERGE|ALTER|DROP|TRUNCATE|CREATE|GRANT|REVOKE|COPY|CALL|DO)\b/i,
    );
    assert.doesNotMatch(query, /\b(?:json_agg|array_agg|string_agg|json_build_object)\b/i);
  }
  assert.doesNotMatch(LEGACY_CONTAMINATION_QUERY, /SELECT\s+(?:post\.)?raw\b/i);
  assert.doesNotMatch(LEGACY_CONTAMINATION_QUERY, /SELECT\s+(?:channel\.)?cursor\b/i);
  assert.doesNotMatch(LEGACY_CONTAMINATION_QUERY, /SELECT\s+(?:run\.)?detail\b/i);
});
