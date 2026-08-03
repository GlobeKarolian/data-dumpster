import 'server-only';
import { sql } from 'drizzle-orm';
import { db } from '@/db';
import { REPORT_TIME_ZONE, toDayString } from '@/lib/dates';

/**
 * Did every tracked channel get read today?
 *
 * This exists because audience is the one metric with no second chance. A
 * follower count is only knowable on the day it is read: if a channel is not
 * visited before midnight, that day is permanently blank and no amount of
 * later collection recovers it. Posts are different, since a post keeps its
 * timestamp and a later run backfills it fine.
 *
 * The product had a schedule and no verification. Nobody found out a day was
 * missed until a weekly report a week later showed a gap, by which point the
 * reading was gone. Six of seven days in one window were uneven and one day was
 * absent entirely, and the first sign of it was fifteen lines of caveats.
 *
 * So the check runs while the day is still open and there is still time to fix
 * it, and it reports what it could not fix.
 */

export interface DayCoverage {
  /** Calendar day in the report zone. */
  day: string;
  activeChannels: number;
  observedChannels: number;
  /** 0 to 1. */
  ratio: number;
  complete: boolean;
}

export interface CoverageGap {
  channelId: string;
  companyName: string;
  platform: string;
  handle: string;
}

/**
 * Channels with no audience reading for the given day.
 *
 * Deliberately compares against `audience_snapshots`, not `channels.
 * last_ingested_at`. A run can finish, be recorded as a success, and still
 * write no snapshot, which is exactly what the Reddit adapter does today. The
 * question is whether the reading exists, not whether a job ran.
 */
export async function coverageGaps(day: string): Promise<CoverageGap[]> {
  const { rows } = await db.execute<{
    channel_id: string; company_name: string; platform: string; handle: string;
  }>(sql`
    SELECT ch.id AS channel_id, c.name AS company_name,
           ch.platform::text AS platform, ch.handle
      FROM channels ch
      JOIN companies c ON c.id = ch.company_id
     WHERE ch.active
       AND NOT EXISTS (
         SELECT 1 FROM audience_snapshots a
          WHERE a.channel_id = ch.id AND a.day = ${day}::date
       )
     ORDER BY c.name, ch.platform
  `);
  return rows.map((r) => ({
    channelId: r.channel_id,
    companyName: r.company_name,
    platform: r.platform,
    handle: r.handle,
  }));
}

/** Per-day coverage for the trailing window, newest first. */
export async function recentCoverage(days = 14): Promise<DayCoverage[]> {
  const { rows } = await db.execute<{
    day: string; observed: number; active: number;
  }>(sql`
    WITH days AS (
      SELECT generate_series(
        (now() AT TIME ZONE ${REPORT_TIME_ZONE})::date - ${days - 1}::int,
        (now() AT TIME ZONE ${REPORT_TIME_ZONE})::date,
        '1 day'
      )::date AS day
    ),
    active AS (SELECT count(*)::int AS n FROM channels WHERE active)
    SELECT d.day::text AS day,
           (SELECT count(DISTINCT a.channel_id)::int
              FROM audience_snapshots a
              JOIN channels ch ON ch.id = a.channel_id AND ch.active
             WHERE a.day = d.day) AS observed,
           active.n AS active
      FROM days d CROSS JOIN active
     ORDER BY d.day DESC
  `);
  return rows.map((r) => {
    const activeChannels = Number(r.active) || 0;
    const observedChannels = Number(r.observed) || 0;
    const ratio = activeChannels > 0 ? observedChannels / activeChannels : 0;
    return {
      day: r.day,
      activeChannels,
      observedChannels,
      ratio,
      // 98% rather than 100%: a handful of channels are legitimately
      // uncollectable on any given day (a deleted account, a private profile),
      // and a threshold nobody can ever hit is a threshold everyone ignores.
      complete: ratio >= 0.98,
    };
  });
}

/** Today, in the zone the whole product reports in. */
export function today(now = new Date()): string {
  return toDayString(now);
}
