/**
 * One-shot ingestion runner.
 *
 *   NODE_ENV=development npm run ingest:once -- --platform=bluesky --dry-run
 *
 * This is the same durable queue and lease path Vercel Cron calls, exposed as a
 * CLI so collection can be exercised without a scheduler, deployment or
 * browser. Every flag narrows what is registered and claimed; with none, it
 * considers every active channel, staleest first.
 *
 * Flags:
 *   --channel=<uuid>       Run exactly one channel.
 *   --platform=<p>         Repeatable, or comma-separated. e.g. bluesky,youtube
 *   --company=<slug>       Only this company's channels.
 *   --since=YYYY-MM-DD     Override the window start. Default is incremental.
 *   --until=YYYY-MM-DD     Override the window end. Default is now.
 *   --limit=N              Max posts per channel. Default 500.
 *   --concurrency=N        Parallel channels. Default 4.
 *   --max-channels=N       Stop after N channels.
 *   --dry-run              Preview targets; no vendor calls and no writes.
 *   --json                 Emit machine-readable JSON instead of a table.
 *
 * Exit code is 1 when every channel that was attempted failed, so a cron
 * wrapper or CI step can tell "nothing worked" from "one competitor's token
 * expired". A run where everything was skipped for missing credentials exits 0
 * with a warning: that is a configuration state, not a failure.
 */
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { PLATFORMS, type Platform } from '../src/lib/types';
import {
  executeManualIngest,
  groupManualIngestTargets,
  type ManualIngestExecution,
  type ManualIngestSelection,
  type ManualIngestTarget,
} from '../src/lib/adapters/manual-ingest';
import type { ChannelRunResult, PlatformSummary } from '../src/lib/adapters/runner';
import type { CollectionQueueSummary } from '../src/lib/adapters/collection-queue';

/* ----------------------------------------------------------------- env */

/**
 * Load .env files before anything imports the database client.
 *
 * next dev does this for us; tsx does not. Database and queue work is therefore
 * deferred until after this has run. Precedence matches Next.js:
 * An injected process variable wins over both files, then .env.local wins over
 * .env. Loading the more specific file first lets every key be written at most
 * once and prevents a local file from redirecting an explicitly selected DB.
 */
function loadEnvFiles(): void {
  for (const file of ['.env.local', '.env']) {
    const path = resolve(process.cwd(), file);
    if (!existsSync(path)) continue;
    const contents = readFileSync(path, 'utf8');
    for (const line of contents.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const eq = trimmed.indexOf('=');
      if (eq <= 0) continue;
      const key = trimmed.slice(0, eq).trim();
      let value = trimmed.slice(eq + 1).trim();
      if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
        value = value.slice(1, -1);
      }
      // A real environment variable always beats either file. Because
      // .env.local is read first, it also beats the base .env file.
      if (process.env[key] !== undefined) continue;
      process.env[key] = value;
    }
  }
}

/* ---------------------------------------------------------------- flags */

interface Flags {
  channel?: string;
  platforms?: Platform[];
  company?: string;
  since?: Date;
  until?: Date;
  limit?: number;
  concurrency?: number;
  maxChannels?: number;
  dryRun: boolean;
  json: boolean;
}

class UsageError extends Error {}

function parseDay(value: string, flag: string): Date {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new UsageError('--' + flag + ' must be YYYY-MM-DD, got "' + value + '"');
  }
  const parsed = new Date(value + 'T00:00:00.000Z');
  if (Number.isNaN(parsed.getTime())) throw new UsageError('--' + flag + ' is not a real date: ' + value);
  return parsed;
}

function parseCount(value: string, flag: string): number {
  const n = Number(value);
  if (!Number.isInteger(n) || n <= 0) throw new UsageError('--' + flag + ' must be a positive integer');
  return n;
}

function parseFlags(argv: string[]): Flags {
  const flags: Flags = { dryRun: false, json: false };
  const platforms: Platform[] = [];

  for (const arg of argv) {
    if (arg === '--dry-run') { flags.dryRun = true; continue; }
    if (arg === '--json') { flags.json = true; continue; }
    if (arg === '--help' || arg === '-h') throw new UsageError('help');

    const match = /^--([a-z-]+)=(.*)$/.exec(arg);
    if (!match) throw new UsageError('Unrecognised argument: ' + arg);
    const [, name, value] = match;

    switch (name) {
      case 'channel': flags.channel = value.trim(); break;
      case 'company': flags.company = value.trim(); break;
      case 'since': flags.since = parseDay(value, 'since'); break;
      case 'until': flags.until = parseDay(value, 'until'); break;
      case 'limit': flags.limit = parseCount(value, 'limit'); break;
      case 'concurrency': flags.concurrency = parseCount(value, 'concurrency'); break;
      case 'max-channels': flags.maxChannels = parseCount(value, 'max-channels'); break;
      case 'platform': {
        for (const raw of value.split(',')) {
          const candidate = raw.trim().toLowerCase();
          if (!candidate) continue;
          if (!(PLATFORMS as readonly string[]).includes(candidate)) {
            throw new UsageError('Unknown platform "' + candidate + '". Valid: ' + PLATFORMS.join(', '));
          }
          platforms.push(candidate as Platform);
        }
        break;
      }
      default:
        throw new UsageError('Unrecognised flag: --' + name);
    }
  }

  if (platforms.length > 0) flags.platforms = platforms;
  if (flags.since && flags.until && flags.since >= flags.until) {
    throw new UsageError('--since must be earlier than --until');
  }
  return flags;
}

const USAGE = [
  'Usage: npm run ingest:once -- [flags]',
  '',
  '  --channel=<uuid>      Run exactly one channel',
  '  --platform=<p>        Comma-separated. ' + PLATFORMS.join(', '),
  '  --company=<slug>      Only this company',
  '  --since=YYYY-MM-DD    Window start (default: incremental from last run)',
  '  --until=YYYY-MM-DD    Window end (default: now)',
  '  --limit=N             Max posts per channel (default 500)',
  '  --concurrency=N       Parallel channels (default 4)',
  '  --max-channels=N      Stop after N channels',
  '  --dry-run             Preview targets; no vendor calls and no writes',
  '  --json                Machine-readable output',
].join('\n');

/* --------------------------------------------------------------- output */

type Align = 'left' | 'right';

interface Column {
  header: string;
  align: Align;
}

/**
 * A fixed-width table.
 *
 * Numbers right-aligned, text left, one line per channel. Deliberately plain
 * text with no colour codes: this output is read as often from a CI log or a
 * cron email as from a terminal, and escape sequences make both worse.
 */
function renderTable(columns: Column[], rows: string[][]): string {
  const widths = columns.map((col, i) => Math.max(
    col.header.length,
    ...rows.map((row) => (row[i] ?? '').length),
  ));

  const line = (cells: string[]): string => cells
    .map((cell, i) => (columns[i].align === 'right' ? cell.padStart(widths[i]) : cell.padEnd(widths[i])))
    .join('  ')
    .trimEnd();

  return [
    line(columns.map((c) => c.header)),
    widths.map((w) => '-'.repeat(w)).join('  '),
    ...rows.map(line),
  ].join('\n');
}

function truncate(value: string, max: number): string {
  return value.length <= max ? value : value.slice(0, max - 1) + '…';
}

function formatDuration(ms: number): string {
  if (ms < 1000) return String(Math.round(ms)) + 'ms';
  return (ms / 1000).toFixed(1) + 's';
}

/** Read-only target discovery. Vendor modules and the writable queue stay lazy. */
async function resolveTargets(selection: ManualIngestSelection): Promise<ManualIngestTarget[]> {
  const [{ db }, schema, orm] = await Promise.all([
    import('../src/db'),
    import('../src/db/schema'),
    import('drizzle-orm'),
  ]);
  const { channels, companies, landscapeCompanies, landscapes } = schema;
  const { and, asc, eq, inArray, sql } = orm;

  const filters = [eq(channels.active, true)];
  if (selection.channel) filters.push(eq(channels.id, selection.channel));
  if (selection.companySlug) filters.push(eq(companies.slug, selection.companySlug));
  if (selection.platforms?.length) {
    filters.push(inArray(channels.platform, [...selection.platforms]));
  }

  const rows = await db
    .select({
      channelId: channels.id,
      platform: channels.platform,
      handle: channels.handle,
      companyName: companies.name,
      companySlug: companies.slug,
      lastIngestedAt: channels.lastIngestedAt,
      landscapeId: landscapes.id,
      orgId: landscapes.orgId,
    })
    .from(channels)
    .innerJoin(companies, eq(companies.id, channels.companyId))
    .leftJoin(landscapeCompanies, eq(landscapeCompanies.companyId, companies.id))
    .leftJoin(landscapes, eq(landscapes.id, landscapeCompanies.landscapeId))
    .where(and(...filters))
    .orderBy(
      sql`${channels.lastIngestedAt} asc nulls first`,
      asc(channels.id),
      asc(landscapes.id),
    );

  return groupManualIngestTargets(rows, selection.maxChannels ?? 1_000);
}

/* ----------------------------------------------------------------- main */

async function main(): Promise<number> {
  let flags: Flags;
  try {
    flags = parseFlags(process.argv.slice(2));
  } catch (err) {
    if (err instanceof UsageError) {
      if (err.message === 'help') { process.stdout.write(USAGE + '\n'); return 0; }
      process.stderr.write(err.message + '\n\n' + USAGE + '\n');
      return 2;
    }
    throw err;
  }

  loadEnvFiles();

  if (!process.env.DATABASE_URL && !process.env.POSTGRES_URL) {
    process.stderr.write(
      'DATABASE_URL is not set and no .env file supplied one. See .env.example.\n',
    );
    return 2;
  }

  const started = Date.now();
  let queueModule: Promise<typeof import('../src/lib/adapters/collection-queue')> | undefined;
  const loadQueue = (): Promise<typeof import('../src/lib/adapters/collection-queue')> => {
    queueModule ??= import('../src/lib/adapters/collection-queue');
    return queueModule;
  };
  const execution = await executeManualIngest({
    selection: {
      channel: flags.channel,
      platforms: flags.platforms,
      companySlug: flags.company,
      maxChannels: flags.maxChannels,
    },
    dryRun: flags.dryRun,
    since: flags.since,
    until: flags.until,
    postLimit: flags.limit,
    // Keep the CLI's historical four-worker default. An explicit flag still
    // passes straight through to the queue.
    concurrency: flags.concurrency ?? 4,
  }, {
    resolveTargets,
    enqueueChannelCollection: async (input) => (
      await loadQueue()
    ).enqueueChannelCollection(input),
    runCollectionQueue: async (input) => (
      await loadQueue()
    ).runCollectionQueue(input),
  });
  const summary = execution.summary;
  const results = summary?.results ?? [];

  if (flags.json) {
    process.stdout.write(JSON.stringify({
      dryRun: flags.dryRun,
      window: { since: execution.since, until: execution.until },
      targets: {
        matched: execution.targets.length,
        eligible: execution.eligibleTargets.length,
        untracked: execution.untrackedTargets,
      },
      registrationCalls: execution.registrationCalls,
      queueSignals: execution.queueSignals,
      summary,
      results,
    }, null, 2) + '\n');
  } else if (flags.dryRun) {
    printPreview(execution);
  } else {
    printHuman(results, summary, Date.now() - started, execution);
  }

  if (execution.targets.length === 0) return flags.channel ? 1 : 0;
  // A channel without a landscape cannot obtain a live demand and therefore
  // cannot be leased. Fresh seed/build-landscape state satisfies this; legacy
  // orphans must be assigned rather than crawled through a bypass.
  if (execution.eligibleTargets.length === 0) return 2;

  const attempted = results.filter((r) => r.status !== 'skipped').length;
  const failed = results.filter((r) => r.status === 'failed').length;

  // "Everything we tried failed" is the only condition that should fail a cron
  // job. A partial run still landed data, and a fully skipped run is a
  // configuration state that a nonzero exit would turn into recurring noise.
  if (attempted > 0 && failed === attempted) return 1;
  return 0;
}

function printPreview(execution: ManualIngestExecution): void {
  const out: string[] = [];
  out.push('DRY RUN: target preview only. Vendor calls: 0. Database writes: 0.');
  out.push(
    'Requested window: ' + execution.since.toISOString()
    + ' to ' + execution.until.toISOString(),
  );
  out.push('');

  if (execution.targets.length === 0) {
    out.push('No channels matched. Nothing to do.');
    process.stdout.write(out.join('\n') + '\n');
    return;
  }

  out.push(renderTable([
    { header: 'PLATFORM', align: 'left' },
    { header: 'COMPANY', align: 'left' },
    { header: 'HANDLE', align: 'left' },
    { header: 'LANDSCAPES', align: 'right' },
    { header: 'ORGS', align: 'right' },
    { header: 'DEMAND', align: 'left' },
  ], execution.targets.map((target) => [
    target.platform,
    truncate(target.companyName, 24),
    truncate(target.handle, 28),
    String(target.landscapeIds.length),
    String(target.orgIds.length),
    target.orgIds.length > 0 ? 'would register' : 'untracked',
  ])));
  out.push('');
  out.push(
    String(execution.eligibleTargets.length) + ' pooled channel target(s) would enter the shared queue; '
    + String(execution.untrackedTargets.length) + ' cannot run until assigned to a landscape.',
  );
  process.stdout.write(out.join('\n') + '\n');
}

function printHuman(
  results: ChannelRunResult[],
  summary: CollectionQueueSummary | undefined,
  wallMs: number,
  execution: ManualIngestExecution,
): void {
  const out: string[] = [];

  if (execution.targets.length === 0) {
    out.push('No channels matched. Nothing to do.');
  } else if (execution.eligibleTargets.length === 0) {
    out.push('No matched channel belongs to a landscape, so no demand was registered and no vendor was called.');
  } else if (results.length === 0) {
    out.push(
      'No channel was claimable in this process. Demand remains in the durable queue; '
      + 'another worker may hold the lease or the work may be deferred.',
    );
  }

  const columns: Column[] = [
    { header: 'STATUS', align: 'left' },
    { header: 'PLATFORM', align: 'left' },
    { header: 'COMPANY', align: 'left' },
    { header: 'HANDLE', align: 'left' },
    { header: 'POSTS', align: 'right' },
    { header: 'SNAPS', align: 'right' },
    { header: 'URLS', align: 'right' },
    { header: 'TAGS', align: 'right' },
    { header: 'CALLS', align: 'right' },
    { header: 'TIME', align: 'right' },
  ];

  const order: Record<string, number> = { failed: 0, partial: 1, skipped: 2, succeeded: 3 };
  const sorted = [...results].sort((a, b) => {
    const byStatus = (order[a.status] ?? 9) - (order[b.status] ?? 9);
    return byStatus !== 0 ? byStatus : a.platform.localeCompare(b.platform);
  });

  if (sorted.length > 0) {
    const rows = sorted.map((r) => [
      r.status,
      r.platform,
      truncate(r.companyName, 24),
      truncate(r.handle, 28),
      String(r.postsUpserted),
      String(r.snapshotsUpserted),
      String(r.urlsRecorded),
      String(r.tagsAssigned),
      String(r.apiCalls),
      formatDuration(r.durationMs),
    ]);

    out.push(renderTable(columns, rows));
    out.push('');

    const problems = sorted.filter((r) => r.error || r.warnings.length > 0);
    if (problems.length > 0) {
      out.push('Notes');
      for (const r of problems) {
        const label = r.platform + ' / ' + r.handle;
        if (r.error) out.push('  [' + r.status + '] ' + label + ': ' + r.error);
        for (const warning of r.warnings) out.push('  [warn] ' + label + ': ' + warning);
      }
      out.push('');
    }
  }

  if (execution.untrackedTargets.length > 0) {
    out.push(
      'Not queued: ' + execution.untrackedTargets.map((target) => (
        target.companyName + ' / ' + target.platform + ' / ' + target.handle
      )).join(', ') + '. Assign these channels to a landscape first.',
    );
    out.push('');
  }

  if (summary) {
    out.push(
      'Totals: ' + String(summary.attempted) + ' attempted, '
      + String(summary.succeeded) + ' succeeded, '
      + String(summary.failed) + ' failed, '
      + String(summary.skipped) + ' skipped, '
      + String(summary.postsUpserted) + ' posts upserted, '
      + formatDuration(wallMs) + ' wall clock.',
    );

    const platformRows = Object.entries(summary.byPlatform)
      .filter((entry): entry is [string, PlatformSummary] => entry[1] !== undefined)
      .map(([platform, s]) => [
        platform, String(s.attempted), String(s.succeeded), String(s.failed),
        String(s.skipped), String(s.postsUpserted),
      ]);

    if (platformRows.length > 0) {
      out.push('');
      out.push(renderTable([
        { header: 'PLATFORM', align: 'left' },
        { header: 'CHANNELS', align: 'right' },
        { header: 'OK', align: 'right' },
        { header: 'FAILED', align: 'right' },
        { header: 'SKIPPED', align: 'right' },
        { header: 'POSTS', align: 'right' },
      ], platformRows));
    }
  } else {
    out.push('Completed in ' + formatDuration(wallMs) + '.');
  }

  process.stdout.write(out.join('\n') + '\n');
}

main()
  .then((code) => { process.exitCode = code; })
  .catch((err: unknown) => {
    const message = err instanceof Error ? (err.stack ?? err.message) : String(err);
    process.stderr.write('Ingest run crashed:\n' + message + '\n');
    process.exitCode = 1;
  });
