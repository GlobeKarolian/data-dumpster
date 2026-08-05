/**
 * Replace the Facebook Page cover mistakenly stored as every Bright Data post
 * preview with the post-specific creative retained in legacy `posts.raw` rows.
 *
 * Dry-run by default:
 *   node --env-file=.env.local --import tsx scripts/repair-facebook-creatives.ts
 *
 * Apply:
 *   node --env-file=.env.local --import tsx scripts/repair-facebook-creatives.ts --apply
 */
import { sql } from 'drizzle-orm';
import { db } from '@/db';
import { mapFacebookVendorPost } from '@/lib/adapters/facebook-brightdata';

interface FacebookRepairRow {
  [key: string]: unknown;
  id: string;
  raw: Record<string, unknown>;
  thumbnail_url: string | null;
  media_url: string | null;
}

interface Repair {
  id: string;
  thumbnailUrl: string | null;
  mediaUrl: string | null;
}

const BATCH_SIZE = 250;
const RANGE = {
  since: new Date(0),
  until: new Date(8_640_000_000_000_000),
};

async function main() {
  const result = await db.execute<FacebookRepairRow>(sql`
    SELECT id, raw, thumbnail_url, media_url
      FROM posts
     WHERE platform = 'facebook'::platform
       AND raw ? 'header_image'
     ORDER BY id
  `);

  const repairs: Repair[] = [];
  let unmappable = 0;
  let withoutCreative = 0;

  for (const row of result.rows) {
    const mapped = mapFacebookVendorPost(row.raw, RANGE);
    if (!mapped) {
      unmappable++;
      continue;
    }
    const thumbnailUrl = mapped.thumbnailUrl ?? null;
    const mediaUrl = mapped.mediaUrl ?? null;
    if (thumbnailUrl === null) withoutCreative++;
    if (
      thumbnailUrl !== row.thumbnail_url
      || mediaUrl !== row.media_url
    ) {
      repairs.push({
        id: row.id,
        thumbnailUrl,
        mediaUrl,
      });
    }
  }

  console.log(JSON.stringify({
    candidates: result.rows.length,
    repairs: repairs.length,
    withoutCreative,
    unmappable,
    mode: process.argv.includes('--apply') ? 'apply' : 'dry-run',
  }));

  if (!process.argv.includes('--apply') || repairs.length === 0) return;

  for (let offset = 0; offset < repairs.length; offset += BATCH_SIZE) {
    const batch = repairs.slice(offset, offset + BATCH_SIZE);
    const values = batch.map((repair) => sql`
      (${repair.id}::uuid, ${repair.thumbnailUrl}::text, ${repair.mediaUrl}::text)
    `);
    await db.execute(sql`
      WITH repair(id, thumbnail_url, media_url) AS (
        VALUES ${sql.join(values, sql`, `)}
      )
      UPDATE posts AS p
         SET thumbnail_url = repair.thumbnail_url,
             media_url = repair.media_url
        FROM repair
       WHERE p.id = repair.id
         AND p.platform = 'facebook'::platform
         AND p.raw ? 'header_image'
    `);
  }

  console.log(JSON.stringify({ applied: repairs.length }));
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    const cause = error instanceof Error
      && typeof error.cause === 'object'
      && error.cause !== null
      && 'message' in error.cause
      ? String(error.cause.message)
      : null;
    console.error(error instanceof Error ? error.message : error);
    if (cause) console.error('Cause: ' + cause);
    process.exit(1);
  });
