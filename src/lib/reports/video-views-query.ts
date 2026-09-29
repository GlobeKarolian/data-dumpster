import 'server-only';
import { sql } from 'drizzle-orm';
import { db } from '@/db';
import { VIDEO_PLAY_PLATFORMS, VIDEO_POST_TYPES, type VideoViewRow } from './video-views';

/** Constant lists only; never user input. */
const list = (values: readonly string[]) => sql.raw(values.map((v) => "'" + v.replace(/'/g, "''") + "'").join(', '));

/** Plays of video posts per company and platform for a landscape's window. */
export async function getVideoViewRows(landscapeId: string, start: Date, end: Date): Promise<VideoViewRow[]> {
  const { rows } = await db.execute<VideoViewRow>(sql`
    SELECT p.company_id, p.platform::text AS platform, coalesce(sum(p.views), 0) AS views
      FROM posts p
      JOIN landscape_companies lc ON lc.company_id = p.company_id
     WHERE lc.landscape_id = ${landscapeId}::uuid
       AND p.posted_at >= ${start.toISOString()}::timestamptz
       AND p.posted_at <= ${end.toISOString()}::timestamptz
       AND p.platform::text IN (${list(VIDEO_PLAY_PLATFORMS)})
       AND p.type::text IN (${list(VIDEO_POST_TYPES)})
       AND p.views > 0
     GROUP BY p.company_id, p.platform`);
  return rows;
}
