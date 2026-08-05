/**
 * Read-only preflight for the global pooled-channel identity migration.
 *
 * Run before `npm run db:migrate`. Any row printed here needs an explicit
 * operator decision about which company owns the public account and which
 * channel history should survive. This script never merges or writes data.
 */
import { sql } from 'drizzle-orm';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

interface ConflictRow extends Record<string, unknown> {
  conflict_type: 'external_id' | 'normalized_identity';
  platform: string;
  identity: string;
  channels: Array<{
    channelId: string;
    companyId: string;
    companyName: string;
    handle: string;
    externalId: string | null;
  }>;
}

interface IdentityMismatchRow extends Record<string, unknown> {
  channel_id: string;
  company_id: string;
  company_name: string;
  platform: string;
  handle: string;
  stored_identity: string;
  computed_identity: string;
}

function loadEnvFiles(): void {
  let databaseTargetLoaded = Boolean(
    process.env.DATABASE_URL ?? process.env.POSTGRES_URL,
  );
  // Local overrides base when neither was explicitly injected; every key is
  // written at most once, so the ambient process environment still wins.
  for (const file of ['.env.local', '.env']) {
    const path = resolve(process.cwd(), file);
    if (!existsSync(path)) continue;
    for (const line of readFileSync(path, 'utf8').split('\n')) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const separator = trimmed.indexOf('=');
      if (separator <= 0) continue;
      const key = trimmed.slice(0, separator).trim();
      let value = trimmed.slice(separator + 1).trim();
      if (
        (value.startsWith('"') && value.endsWith('"'))
        || (value.startsWith("'") && value.endsWith("'"))
      ) value = value.slice(1, -1);
      if (key === 'DATABASE_URL' || key === 'POSTGRES_URL') {
        // These names are aliases for one target. An injected value under
        // either name must not be shadowed by a file under the other name.
        if (databaseTargetLoaded) continue;
        process.env[key] = value;
        databaseTargetLoaded = true;
        continue;
      }
      // An explicitly injected production/staging target always wins. Neither
      // local file may silently redirect a read-only audit to another database.
      if (process.env[key] !== undefined) continue;
      process.env[key] = value;
    }
  }
}

const canonicalIdentitySql = sql<string>`CASE
  WHEN channel.platform = 'youtube'::platform
    AND regexp_replace(btrim(channel.handle), '^@', '') ~ '^UC[A-Za-z0-9_-]{22}$'
    THEN 'channel:' || regexp_replace(btrim(channel.handle), '^@', '')
  WHEN channel.platform = 'reddit'::platform THEN
    CASE
      WHEN lower(regexp_replace(btrim(channel.handle), '^/+|/+$', '', 'g'))
        ~ '^(u|user)/.+$'
        THEN 'user:' || regexp_replace(
          lower(regexp_replace(btrim(channel.handle), '^/+|/+$', '', 'g')),
          '^(u|user)/', ''
        )
      WHEN lower(regexp_replace(btrim(channel.handle), '^/+|/+$', '', 'g'))
        ~ '^r/.+$'
        THEN 'subreddit:' || regexp_replace(
          lower(regexp_replace(btrim(channel.handle), '^/+|/+$', '', 'g')),
          '^r/', ''
        )
      ELSE 'subreddit:' || lower(
        regexp_replace(btrim(channel.handle), '^/+|/+$', '', 'g')
      )
    END
  WHEN channel.platform = 'bluesky'::platform
    AND btrim(channel.handle) ~* '^did:[^:]+:.+$'
    THEN 'did:'
      || lower(split_part(btrim(channel.handle), ':', 2))
      || ':' || substring(btrim(channel.handle) from '^[^:]+:[^:]+:(.+)$')
  ELSE 'handle:' || lower(regexp_replace(btrim(channel.handle), '^@', ''))
END`;

async function main(): Promise<void> {
  loadEnvFiles();
  const { db } = await import('../src/db');

  const result = await db.execute<ConflictRow>(sql`
  WITH identities AS (
    SELECT channel.id,
           channel.company_id,
           company.name AS company_name,
           channel.platform,
           channel.handle,
           nullif(btrim(channel.external_id), '') AS external_id,
           ${canonicalIdentitySql} AS identity_key
      FROM channels channel
      JOIN companies company ON company.id = channel.company_id
  ), conflicts AS (
    SELECT 'normalized_identity'::text AS conflict_type,
           platform,
           identity_key AS identity,
           json_agg(json_build_object(
             'channelId', id,
             'companyId', company_id,
             'companyName', company_name,
             'handle', handle,
             'externalId', external_id
           ) ORDER BY company_name, id) AS channels
      FROM identities
     GROUP BY platform, identity_key
    HAVING count(*) > 1
    UNION ALL
    SELECT 'external_id'::text,
           platform,
           external_id,
           json_agg(json_build_object(
             'channelId', id,
             'companyId', company_id,
             'companyName', company_name,
             'handle', handle,
             'externalId', external_id
           ) ORDER BY company_name, id)
      FROM identities
     WHERE external_id IS NOT NULL
     GROUP BY platform, external_id
    HAVING count(*) > 1
  )
  SELECT conflict_type, platform::text, identity, channels
    FROM conflicts
   ORDER BY conflict_type, platform::text, identity
  `);

  const identityColumn = await db.execute<{ present: boolean } & Record<string, unknown>>(sql`
    SELECT EXISTS (
      SELECT 1
        FROM information_schema.columns
       WHERE table_schema = current_schema()
         AND table_name = 'channels'
         AND column_name = 'identity_key'
    ) AS present
  `);
  const mismatches = identityColumn.rows[0]?.present
    ? (await db.execute<IdentityMismatchRow>(sql`
        SELECT channel.id AS channel_id,
               channel.company_id,
               company.name AS company_name,
               channel.platform::text AS platform,
               channel.handle,
               channel.identity_key AS stored_identity,
               ${canonicalIdentitySql} AS computed_identity
          FROM channels channel
          JOIN companies company ON company.id = channel.company_id
         WHERE channel.identity_key IS DISTINCT FROM ${canonicalIdentitySql}
         ORDER BY channel.platform::text, company.name, channel.id
      `)).rows
    : [];

  if (result.rows.length === 0 && mismatches.length === 0) {
    console.log('Channel identity audit passed: no global conflicts or identity drift.');
    return;
  }

  console.error(JSON.stringify({
    error: 'Global channel identity conflicts or stored-key drift must be resolved.',
    conflicts: result.rows,
    identityMismatches: mismatches,
  }, null, 2));
  process.exitCode = 1;
}

void main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : 'Channel identity audit failed.');
  process.exitCode = 1;
});
