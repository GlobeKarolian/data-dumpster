/**
 * Shared plumbing for the weekly report endpoints.
 *
 * The single most important line in this file is the org guard in `loadReport`.
 * Every route under /api/reports reads or writes a row identified by a UUID that
 * arrived from a client, and a UUID from a client is a claim. It becomes a fact
 * only after the row has been matched on both id and orgId, which is why no
 * handler is allowed to select a report any other way.
 */
import { z } from 'zod';
import { and, eq } from 'drizzle-orm';
import { db } from '@/db';
import { orgs, weeklyReports } from '@/db/schema';
import {
  assertLandscapeAccessible,
  AuthError,
  type OrgContext,
} from '@/lib/session';
import { sanitizeReportNarrative } from '@/lib/reports/narrative-verification';
import {
  defaultReportTitle,
  readComputed,
  readManual,
  readNarrative,
  type ManualState,
  type NarrativeBlock,
} from '@/lib/reports/types';
import type { ReportDocument } from '@/lib/reports/render';

export const reportIdSchema = z.uuid('That is not a report id.');

export const daySchema = z.iso.date('Report periods are yyyy-mm-dd days.');

export const manualSchema = z.object({
  tables: z.record(
    z.string(),
    z.object({
      raw: z.string().max(400_000),
      rows: z.array(z.array(z.string().max(4_000))).max(2_000),
      updatedAt: z.string().nullable(),
      breakdown: z.record(z.string(), z.array(z.string().max(4_000))).optional(),
    }),
  ).default({}),
  figures: z.record(z.string(), z.string().max(200)).default({}),
});

export const narrativeSchema = z.record(z.string(), z.string().max(20_000));

export type ReportRow = typeof weeklyReports.$inferSelect;

/** Fetch a report, or refuse in a way that does not confirm it exists. */
export async function loadReport(id: string, ctx: OrgContext): Promise<ReportRow> {
  const [row] = await db
    .select()
    .from(weeklyReports)
    .where(and(eq(weeklyReports.id, id), eq(weeklyReports.orgId, ctx.orgId)))
    .limit(1);
  if (!row) throw new AuthError('not_found', 'That report does not exist.');
  if (row.landscapeId) await assertLandscapeAccessible(row.landscapeId, ctx);
  return row;
}

export async function orgName(orgId: string): Promise<string> {
  const [row] = await db.select({ name: orgs.name }).from(orgs).where(eq(orgs.id, orgId)).limit(1);
  return row?.name ?? 'Your organization';
}

/** The row as the renderers and the drafting prompt want to see it. */
export function toReportDocument(row: ReportRow, org: string): ReportDocument {
  const period = { start: row.periodStart, end: row.periodEnd };
  return {
    title: row.title || defaultReportTitle(period),
    orgName: org,
    period,
    dataNote: row.dataNote,
    computed: readComputed(row.computed),
    manual: readManual(row.manual),
    narrative: readNarrative(row.narrative),
  };
}

/** The JSON body every report endpoint returns, with jsonb already normalized. */
export function serializeReport(row: ReportRow): {
  id: string;
  landscapeId: string | null;
  periodStart: string;
  periodEnd: string;
  title: string;
  dataNote: string | null;
  status: string;
  computed: ReturnType<typeof readComputed>;
  manual: ManualState;
  narrative: NarrativeBlock;
  createdAt: string;
  updatedAt: string;
} {
  const computed = readComputed(row.computed);
  const manual = readManual(row.manual);
  const storedNarrative = readNarrative(row.narrative);
  const { narrative } = sanitizeReportNarrative({
    title: row.title,
    orgName: '',
    period: { start: row.periodStart, end: row.periodEnd },
    dataNote: row.dataNote,
    computed,
    manual,
    narrative: storedNarrative,
  });
  return {
    id: row.id,
    landscapeId: row.landscapeId,
    periodStart: row.periodStart,
    periodEnd: row.periodEnd,
    title: row.title,
    dataNote: row.dataNote,
    status: row.status,
    computed,
    manual,
    narrative,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

/** Postgres unique-violation, which here means "that week already has a report". */
export function isUniqueViolation(err: unknown): boolean {
  if (typeof err !== 'object' || err === null) return false;
  const code = (err as { code?: unknown }).code;
  const causeCode = (err as { cause?: { code?: unknown } }).cause?.code;
  return code === '23505' || causeCode === '23505';
}
