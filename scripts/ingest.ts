/**
 * One-shot ingestion runner.
 *
 *   NODE_ENV=development npm run ingest:once -- --platform=bluesky --dry-run
 *
 * This is the same code path Vercel Cron will call, exposed as a CLI so that
 * ingestion can be exercised, debugged and demonstrated without a scheduler,
 * a deployment or a browser. Every flag narrows what runs; with none, it runs
 * every active channel that has an adapter and credentials, staleest first.
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
 *   --dry-run              Fetch and report, write nothing.
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
// Type-only: erased at compile time, so it does not pull the database client in
// before loadEnvFiles has run. The value import is dynamic, further down.
import type { ChannelRunResult, PlatformSummary, RunAllSummary } from '../src/lib/adapters/runner';

/* ----------------------------------------------------------------- env */

/**
 * Load .env files before anything imports the database client.
 *
 * next dev does this for us; tsx does not, and src/db/index.ts throws at import
 * time when DATABASE_URL is missing. The import of the runner is therefore
 * deferred until after this has run. Precedence matches Next.js:
 * .env.local wins over .env.
 */
function loadEnvFiles(): void {
  for (const file of ['.env', '.env.local']) {
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
      // A real environment variable always beats a file, so a one-off
      // DATABASE_URL=... on the command line does what the operator expects.
      if (file === '.env' && process.env[key] !== undefined) continue;
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
  '  --dry-run             Fetch and report, write nothing',
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

  // Imported after the env is loaded: src/db/index.ts throws at module scope
  // when DATABASE_URL is missing, so a static import would fail before the
  // helpful message above could ever print.
  const { runAllDue, runChannelIngest } = await import('../src/lib/adapters/runner');

  const started = Date.now();
  let results: ChannelRunResult[];
  let summary: RunAllSummary | undefined;

  if (flags.channel) {
    results = [await runChannelIngest(flags.channel, {
      since: flags.since,
      until: flags.until,
      limit: flags.limit,
      dryRun: flags.dryRun,
    })];
  } else {
    summary = await runAllDue({
      platforms: flags.platforms,
      companySlug: flags.company,
      since: flags.since,
      until: flags.until,
      limit: flags.limit,
      concurrency: flags.concurrency,
      maxChannels: flags.maxChannels,
      dryRun: flags.dryRun,
    });
    results = summary.results;
  }

  if (flags.json) {
    process.stdout.write(JSON.stringify({ dryRun: flags.dryRun, summary, results }, null, 2) + '\n');
  } else {
    printHuman(results, summary, Date.now() - started, flags.dryRun);
  }

  const attempted = results.filter((r) => r.status !== 'skipped').length;
  const failed = results.filter((r) => r.status === 'failed').length;

  // "Everything we tried failed" is the only condition that should fail a cron
  // job. A partial run still landed data, and a fully skipped run is a
  // configuration state that a nonzero exit would turn into recurring noise.
  if (attempted > 0 && failed === attempted) return 1;
  return 0;
}

function printHuman(
  results: ChannelRunResult[],
  summary: RunAllSummary | undefined,
  wallMs: number,
  dryRun: boolean,
): void {
  const out: string[] = [];

  if (dryRun) out.push('DRY RUN: fetched from the platforms, wrote nothing.\n');

  if (results.length === 0) {
    out.push('No channels matched. Nothing to do.');
    process.stdout.write(out.join('\n') + '\n');
    return;
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
