/**
 * Strictly read-only release gate for legacy owner/private contamination.
 *
 * The Neon client executes exactly two aggregate SELECTs inside a database-
 * enforced READ ONLY, repeatable-read transaction. The report contains counts
 * and classifications only; no raw payload, cursor, run detail, post content,
 * handle, media value, credential, or database URL is selected or printed.
 */
import { neon } from '@neondatabase/serverless';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  INVENTORY_SCHEMA_QUERY,
  LEGACY_CONTAMINATION_QUERY,
  summarizeLegacyContamination,
  type LegacyContaminationAggregateRow,
  type SchemaColumnRow,
} from '../src/lib/owned-data-inventory';

function loadEnvFiles(): void {
  let databaseTargetLoaded = Boolean(
    process.env.DATABASE_URL ?? process.env.POSTGRES_URL,
  );
  for (const file of ['.env.local', '.env']) {
    const path = resolve(process.cwd(), file);
    if (!existsSync(path)) continue;
    for (const line of readFileSync(path, 'utf8').split('\n')) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const separator = trimmed.indexOf('=');
      if (separator <= 0) continue;
      const key = trimmed.slice(0, separator).trim();
      if (key !== 'DATABASE_URL' && key !== 'POSTGRES_URL') continue;
      let value = trimmed.slice(separator + 1).trim();
      if (
        (value.startsWith('"') && value.endsWith('"'))
        || (value.startsWith("'") && value.endsWith("'"))
      ) value = value.slice(1, -1);
      if (databaseTargetLoaded) continue;
      process.env[key] = value;
      databaseTargetLoaded = true;
    }
  }
}

async function main(): Promise<void> {
  loadEnvFiles();
  const databaseUrl = (process.env.DATABASE_URL ?? process.env.POSTGRES_URL)?.trim();
  if (!databaseUrl) {
    console.error('Owned-data contamination inventory failed closed: DATABASE_URL or POSTGRES_URL is not set.');
    process.exitCode = 2;
    return;
  }

  let schemaRows: SchemaColumnRow[];
  let aggregateRows: LegacyContaminationAggregateRow[];
  try {
    const client = neon(databaseUrl);
    const results = await client.transaction(
      (query) => [
        query.query(INVENTORY_SCHEMA_QUERY),
        query.query(LEGACY_CONTAMINATION_QUERY),
      ],
      {
        isolationLevel: 'RepeatableRead',
        readOnly: true,
      },
    );
    schemaRows = results[0] as unknown as SchemaColumnRow[];
    aggregateRows = results[1] as unknown as LegacyContaminationAggregateRow[];
  } catch {
    // Database errors can include connection and server context. Do not echo
    // them from a command whose output may be retained as compliance evidence.
    console.error('Owned-data contamination inventory failed closed: the read-only database inventory could not complete.');
    process.exitCode = 2;
    return;
  }

  try {
    const report = summarizeLegacyContamination(
      aggregateRows,
      schemaRows,
      new Date().toISOString(),
    );
    console.log(JSON.stringify(report, null, 2));
    if (report.blocked) process.exitCode = 1;
  } catch (error) {
    const message = error instanceof Error
      ? error.message
      : 'The aggregate inventory result was invalid.';
    console.error('Owned-data contamination inventory failed closed: ' + message);
    process.exitCode = 2;
  }
}

void main();
