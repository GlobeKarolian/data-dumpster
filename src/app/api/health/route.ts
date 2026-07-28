/**
 * GET /api/health -- is this deployment actually working?
 *
 * Unauthenticated by design: an uptime probe has no credentials, and a health
 * check that needs a session tells you nothing about the case you care about,
 * which is the app being broken for everyone.
 *
 * Because it is public, everything here is either a boolean or an aggregate.
 * Configuration is reported as "is it set", never as a value or a fingerprint.
 * Ingest freshness is reported per platform and as a count, never as a list of
 * which of a newsroom's competitors it is failing to read.
 *
 * The distinction between "the app is up" and "the data is fresh" is kept
 * explicit: a deployment that responds but has not ingested in three days is not
 * healthy, and a single green tick would hide that.
 */
import { sql } from 'drizzle-orm';
import { db } from '@/db';
import { apiHandler } from '@/lib/session';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** A channel that has not been read in a day is behind, whatever the cron says. */
const STALE_AFTER_HOURS = 24;

type PlatformRow = { platform: string; last_success: string | null; channels: number } & Record<string, unknown>;
type OverdueRow = { overdue: number; total: number } & Record<string, unknown>;

export const GET = apiHandler(async () => {
  const config = {
    databaseUrl: Boolean(process.env.DATABASE_URL ?? process.env.POSTGRES_URL),
    authSecret: Boolean(process.env.AUTH_SECRET),
    encryptionKey: Boolean(process.env.ENCRYPTION_KEY),
    cronSecret: Boolean(process.env.CRON_SECRET),
  };

  let database = false;
  let platforms: PlatformRow[] = [];
  let overdue = 0;
  let activeChannels = 0;

  try {
    await db.execute(sql`select 1`);
    database = true;

    const ingest = await db.execute<PlatformRow>(sql`
      SELECT c.platform::text AS platform,
             max(r.finished_at) FILTER (WHERE r.status IN ('succeeded', 'partial')) AS last_success,
             count(DISTINCT c.id)::int AS channels
        FROM channels c
        LEFT JOIN ingestion_runs r ON r.channel_id = c.id
       WHERE c.active
       GROUP BY c.platform
       ORDER BY c.platform
    `);
    platforms = ingest.rows;

    const stale = await db.execute<OverdueRow>(sql`
      SELECT count(*) FILTER (
               WHERE last_ingested_at IS NULL
                  OR last_ingested_at < now() - interval '${sql.raw(String(STALE_AFTER_HOURS))} hours'
             )::int AS overdue,
             count(*)::int AS total
        FROM channels
       WHERE active
    `);
    overdue = stale.rows[0]?.overdue ?? 0;
    activeChannels = stale.rows[0]?.total ?? 0;
  } catch (err) {
    // Swallowed on purpose: an unreachable database is the single most useful
    // thing this endpoint can report, and it can only report it by answering.
    console.error('[pressbox:health] database check failed', err);
  }

  const configured = Object.values(config).every(Boolean);
  const status = !database ? 'down' : !configured || overdue > 0 ? 'degraded' : 'ok';

  return Response.json(
    {
      status,
      database,
      config,
      ingest: {
        activeChannels,
        overdueChannels: overdue,
        staleAfterHours: STALE_AFTER_HOURS,
        platforms: platforms.map((p) => ({
          platform: p.platform,
          channels: p.channels,
          lastSuccessfulIngestAt: p.last_success,
        })),
      },
      checkedAt: new Date().toISOString(),
    },
    { status: database ? 200 : 503, headers: { 'cache-control': 'no-store' } },
  );
});
