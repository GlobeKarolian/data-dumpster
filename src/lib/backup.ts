/**
 * Nightly logical backup of the Neon database to Vercel Blob.
 *
 * Why this exists: Neon is the only copy of an append-only history that
 * cannot be re-collected — vendors do not sell the past. Neon's own
 * point-in-time restore protects against bad writes, but it lives with the
 * same provider as the data. This produces a nightly copy OFF Neon, in the
 * Blob store that already holds archived thumbnails.
 *
 * Why not pg_dump: serverless functions have no pg_dump binary and the Neon
 * HTTP driver speaks single statements, not COPY. So this is a logical
 * export: every table streamed as gzipped NDJSON, one blob per table per
 * date, plus a manifest. NDJSON restores anywhere — psql, a script, another
 * Postgres — without matching pg_dump versions.
 *
 * Why resumable: the whole database does not reliably fit one function
 * invocation. Each run processes tables until the time budget is nearly
 * spent, then reports what remains; the cron route chains another invocation
 * for the remainder. The manifest is written last, only when nothing
 * remains, so its presence IS completion — health checks read exactly that.
 */
import { gzipSync } from 'node:zlib';
import { list, put } from '@vercel/blob';
import { sql } from 'drizzle-orm';
import { db } from '@/db';

const PREFIX = 'db-backups';
/** Keyset page size; large tables stream in pages without blowing memory. */
const PAGE_ROWS = 5_000;
/** Stop starting new tables when this much of the budget remains. */
const RESERVE_MS = 45_000;

/** Tables in dependency-light order; contents matter more than sequence. */
async function allTables(): Promise<string[]> {
  const { rows } = await db.execute<{ table_name: string }>(sql`
    SELECT table_name FROM information_schema.tables
     WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
     ORDER BY table_name`);
  return rows.map((r) => r.table_name);
}

function datePath(day: string, table: string): string {
  return `${PREFIX}/${day}/${table}.ndjson.gz`;
}

async function doneTables(day: string): Promise<Set<string>> {
  const done = new Set<string>();
  let cursor: string | undefined;
  do {
    const page = await list({ prefix: `${PREFIX}/${day}/`, cursor });
    for (const blob of page.blobs) {
      const name = blob.pathname.split('/').pop() ?? '';
      if (name.endsWith('.ndjson.gz')) done.add(name.replace(/\.ndjson\.gz$/, ''));
    }
    cursor = page.hasMore ? page.cursor : undefined;
  } while (cursor);
  return done;
}

/**
 * Export one table completely. ctid-keyset pagination works on every table
 * regardless of primary key shape, and this reader runs against a database
 * whose writers only ever append — a row moving mid-export is not a mode this
 * system has.
 */
async function exportTable(table: string, day: string): Promise<{ rows: number; bytes: number }> {
  // information_schema-sourced name, quoted anyway.
  const quoted = '"' + table.replace(/"/g, '') + '"';
  const chunks: Buffer[] = [];
  let rowCount = 0;
  let lastTid: string | null = null;
  for (;;) {
    const where: string = lastTid === null ? '' : ` WHERE ctid > '${lastTid}'::tid`;
    const { rows } = await db.execute<{ __tid: string; row: unknown }>(sql.raw(
      `SELECT ctid::text AS __tid, to_jsonb(t.*) AS row FROM ${quoted} t${where} ORDER BY ctid LIMIT ${PAGE_ROWS}`,
    ));
    if (rows.length === 0) break;
    const lines = rows.map((r) => JSON.stringify(r.row)).join('\n') + '\n';
    chunks.push(gzipSync(Buffer.from(lines, 'utf8')));
    rowCount += rows.length;
    lastTid = rows[rows.length - 1].__tid;
    if (rows.length < PAGE_ROWS) break;
  }
  // Concatenated gzip members are a valid gzip stream (RFC 1952 § 2.2).
  const body = Buffer.concat(chunks.length > 0 ? chunks : [gzipSync(Buffer.alloc(0))]);
  await put(datePath(day, table), body, {
    // The store is private, which is exactly right for a database export:
    // these blobs are reachable only with the store token, never by URL.
    access: 'private',
    contentType: 'application/gzip',
    addRandomSuffix: false,
    allowOverwrite: true,
  } as never);
  return { rows: rowCount, bytes: body.byteLength };
}

export interface BackupRunResult {
  day: string;
  completedThisRun: { table: string; rows: number; bytes: number }[];
  remaining: string[];
  finished: boolean;
}

export async function runBackupSlice(budgetMs: number): Promise<BackupRunResult> {
  const started = Date.now();
  const day = new Date().toISOString().slice(0, 10);
  const tables = await allTables();
  const done = await doneTables(day);
  const remaining = tables.filter((t) => !done.has(t));
  const completedThisRun: BackupRunResult['completedThisRun'] = [];

  for (const table of remaining) {
    if (Date.now() - started > budgetMs - RESERVE_MS) break;
    const result = await exportTable(table, day);
    completedThisRun.push({ table, ...result });
  }

  const nowDone = await doneTables(day);
  const stillRemaining = tables.filter((t) => !nowDone.has(t));
  const finished = stillRemaining.length === 0;
  if (finished) {
    const manifest = {
      day,
      tables: tables.length,
      completedAt: new Date().toISOString(),
    };
    await put(`${PREFIX}/${day}/manifest.json`, JSON.stringify(manifest, null, 2), {
      access: 'private',
      contentType: 'application/json',
      addRandomSuffix: false,
      allowOverwrite: true,
    } as never);
  }
  return { day, completedThisRun, remaining: stillRemaining, finished };
}

export interface BackupStatus {
  lastCompletedDay: string | null;
  ageHours: number | null;
  stale: boolean;
}

/** For /api/health: when did a backup last COMPLETE (manifest present). */
export async function backupStatus(): Promise<BackupStatus> {
  // Look back a week of date-stamped folders; the newest manifest wins.
  for (let i = 0; i < 7; i++) {
    const day = new Date(Date.now() - i * 86_400_000).toISOString().slice(0, 10);
    const page = await list({ prefix: `${PREFIX}/${day}/manifest.json` });
    const manifest = page.blobs.find((b) => b.pathname.endsWith('manifest.json'));
    if (manifest) {
      const ageHours = (Date.now() - new Date(manifest.uploadedAt).getTime()) / 3_600_000;
      return { lastCompletedDay: day, ageHours: Math.round(ageHours * 10) / 10, stale: ageHours > 26 };
    }
  }
  return { lastCompletedDay: null, ageHours: null, stale: true };
}
