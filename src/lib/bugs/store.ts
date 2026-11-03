import 'server-only';
import { sql } from 'drizzle-orm';
import { db } from '@/db';
import type { BugArea, BugSeverity, BugStatus } from './parse';
import type { BugDiagnostics } from './diagnose';

/**
 * Bug reports. Created on first use with idempotent DDL (also committed as
 * drizzle/0044_bug_reports.sql), following the leakage_runs precedent: the
 * table is new, additive and read by nothing else, so a first request creating
 * it cannot race or break an existing screen.
 */
const DDL = [
  sql`CREATE TABLE IF NOT EXISTS bug_reports (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    number bigserial UNIQUE,
    org_id uuid NOT NULL,
    reported_by uuid,
    reporter_email text,
    description text NOT NULL,
    expected text,
    page_url text,
    landscape_id uuid,
    context jsonb NOT NULL DEFAULT '{}'::jsonb,
    status text NOT NULL DEFAULT 'new',
    area text,
    severity text,
    triage jsonb,
    diagnostics jsonb,
    duplicate_of uuid,
    resolution_note text,
    triaged_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
  )`,
  sql`CREATE INDEX IF NOT EXISTS bug_reports_org_status_idx ON bug_reports (org_id, status, created_at DESC)`,
  sql`CREATE INDEX IF NOT EXISTS bug_reports_org_created_idx ON bug_reports (org_id, created_at DESC)`,
];

let ready: Promise<void> | null = null;
export function ensureBugSchema(): Promise<void> {
  ready ??= (async () => {
    for (const statement of DDL) await db.execute(statement);
  })().catch((error) => {
    ready = null;
    throw error;
  });
  return ready;
}

export interface BugContext {
  route?: string;
  userAgent?: string;
  viewport?: { width: number; height: number };
  filters?: Record<string, string>;
  consoleErrors?: string[];
  buildId?: string | null;
}

export interface BugTriage {
  method: 'model' | 'rules';
  summary: string;
  likelyCause: string | null;
  nextStep: string | null;
  /** Why the model answer was replaced by rules, when it was. */
  fallbackReason?: string;
  model?: string;
}

export interface BugReport {
  id: string;
  number: number;
  orgId: string;
  reportedBy: string | null;
  reporterEmail: string | null;
  description: string;
  expected: string | null;
  pageUrl: string | null;
  landscapeId: string | null;
  context: BugContext;
  status: BugStatus;
  area: BugArea | null;
  severity: BugSeverity | null;
  triage: BugTriage | null;
  diagnostics: BugDiagnostics | null;
  duplicateOf: string | null;
  duplicateOfNumber: number | null;
  resolutionNote: string | null;
  triagedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

type Row = {
  id: string;
  number: string | number;
  org_id: string;
  reported_by: string | null;
  reporter_email: string | null;
  description: string;
  expected: string | null;
  page_url: string | null;
  landscape_id: string | null;
  context: BugContext | null;
  status: BugStatus;
  area: BugArea | null;
  severity: BugSeverity | null;
  triage: BugTriage | null;
  diagnostics: BugDiagnostics | null;
  duplicate_of: string | null;
  duplicate_of_number: string | number | null;
  resolution_note: string | null;
  triaged_at: string | Date | null;
  created_at: string | Date;
  updated_at: string | Date;
} & Record<string, unknown>;

const iso = (v: string | Date | null): string | null =>
  v === null ? null : v instanceof Date ? v.toISOString() : new Date(v).toISOString();

function toReport(r: Row): BugReport {
  return {
    id: r.id,
    number: Number(r.number),
    orgId: r.org_id,
    reportedBy: r.reported_by,
    reporterEmail: r.reporter_email,
    description: r.description,
    expected: r.expected,
    pageUrl: r.page_url,
    landscapeId: r.landscape_id,
    context: r.context ?? {},
    status: r.status,
    area: r.area,
    severity: r.severity,
    triage: r.triage,
    diagnostics: r.diagnostics,
    duplicateOf: r.duplicate_of,
    duplicateOfNumber: r.duplicate_of_number === null ? null : Number(r.duplicate_of_number),
    resolutionNote: r.resolution_note,
    triagedAt: iso(r.triaged_at),
    createdAt: iso(r.created_at)!,
    updatedAt: iso(r.updated_at)!,
  };
}

const SELECT = sql`
  SELECT b.*, d.number AS duplicate_of_number
    FROM bug_reports b
    LEFT JOIN bug_reports d ON d.id = b.duplicate_of
`;

export interface NewBugReport {
  orgId: string;
  userId: string | null;
  email: string | null;
  description: string;
  expected: string | null;
  pageUrl: string | null;
  landscapeId: string | null;
  context: BugContext;
}

export async function createBugReport(input: NewBugReport): Promise<{ id: string; number: number }> {
  await ensureBugSchema();
  const { rows } = await db.execute<{ id: string; number: string | number }>(sql`
    INSERT INTO bug_reports (org_id, reported_by, reporter_email, description, expected, page_url, landscape_id, context)
    VALUES (${input.orgId}::uuid, ${input.userId}::uuid, ${input.email}, ${input.description}, ${input.expected},
            ${input.pageUrl}, ${input.landscapeId}::uuid, ${JSON.stringify(input.context)}::jsonb)
    RETURNING id, number
  `);
  return { id: rows[0].id, number: Number(rows[0].number) };
}

export async function getBugReport(orgId: string, id: string): Promise<BugReport | null> {
  await ensureBugSchema();
  const { rows } = await db.execute<Row>(sql`${SELECT} WHERE b.org_id = ${orgId}::uuid AND b.id = ${id}::uuid`);
  return rows[0] ? toReport(rows[0]) : null;
}

export async function listBugReports(
  orgId: string,
  opts: { statuses?: BugStatus[]; limit?: number } = {},
): Promise<BugReport[]> {
  await ensureBugSchema();
  const limit = Math.min(Math.max(opts.limit ?? 100, 1), 500);
  const statusFilter = opts.statuses?.length
    ? sql`AND b.status IN (SELECT jsonb_array_elements_text(${JSON.stringify(opts.statuses)}::jsonb))`
    : sql``;
  const { rows } = await db.execute<Row>(sql`
    ${SELECT}
     WHERE b.org_id = ${orgId}::uuid ${statusFilter}
     ORDER BY b.created_at DESC
     LIMIT ${limit}
  `);
  return rows.map(toReport);
}

/** Open reports other than this one, for duplicate detection. */
export async function openReportsForDedupe(orgId: string, excludeId: string): Promise<Array<{
  id: string; number: number; area: string | null; description: string;
}>> {
  await ensureBugSchema();
  const { rows } = await db.execute<{ id: string; number: string | number; area: string | null; description: string }>(sql`
    SELECT id, number, area, left(description, 400) AS description
      FROM bug_reports
     WHERE org_id = ${orgId}::uuid
       AND id <> ${excludeId}::uuid
       AND status IN ('new', 'triaged', 'in_progress')
     ORDER BY created_at DESC
     LIMIT 25
  `);
  return rows.map((r) => ({ ...r, number: Number(r.number) }));
}

export async function saveTriage(input: {
  id: string;
  area: BugArea;
  severity: BugSeverity;
  triage: BugTriage;
  diagnostics: BugDiagnostics;
  duplicateOf: string | null;
}): Promise<void> {
  await ensureBugSchema();
  await db.execute(sql`
    UPDATE bug_reports
       SET area = ${input.area},
           severity = ${input.severity},
           triage = ${JSON.stringify(input.triage)}::jsonb,
           diagnostics = ${JSON.stringify(input.diagnostics)}::jsonb,
           duplicate_of = ${input.duplicateOf}::uuid,
           -- Triage never overrides a status a person already set.
           status = CASE WHEN status = 'new' THEN 'triaged' ELSE status END,
           triaged_at = now(),
           updated_at = now()
     WHERE id = ${input.id}::uuid
  `);
}

export async function updateBugReport(orgId: string, id: string, patch: {
  status?: BugStatus;
  resolutionNote?: string | null;
}): Promise<boolean> {
  await ensureBugSchema();
  const sets = [sql`updated_at = now()`];
  if (patch.status) sets.push(sql`status = ${patch.status}`);
  if (patch.resolutionNote !== undefined) sets.push(sql`resolution_note = ${patch.resolutionNote}`);
  const { rows } = await db.execute<{ id: string }>(sql`
    UPDATE bug_reports SET ${sql.join(sets, sql`, `)}
     WHERE org_id = ${orgId}::uuid AND id = ${id}::uuid
    RETURNING id
  `);
  return rows.length > 0;
}

/** Reports a person filed but triage never finished (crash, timeout). */
export async function untriagedReportIds(limit = 10): Promise<Array<{ id: string; orgId: string }>> {
  await ensureBugSchema();
  const { rows } = await db.execute<{ id: string; org_id: string }>(sql`
    SELECT id, org_id FROM bug_reports
     WHERE triaged_at IS NULL AND created_at < now() - interval '5 minutes'
     ORDER BY created_at ASC
     LIMIT ${limit}
  `);
  return rows.map((r) => ({ id: r.id, orgId: r.org_id }));
}
