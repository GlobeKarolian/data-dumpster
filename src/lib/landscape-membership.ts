import { eq, sql } from 'drizzle-orm';
import { db } from '@/db';
import { landscapeCompanies } from '@/db/schema';

/** Deduplicate member ids without changing the requested display order. */
export function normalizedLandscapeMembers(companyIds: readonly string[]): string[] {
  return [...new Set(companyIds)];
}

/**
 * Atomically replace one landscape's membership.
 *
 * Desired rows are inserted or reordered before stale rows are removed, and
 * both operations live in one Postgres statement. A failed insert therefore
 * cannot leave a landscape empty or cascade-delete all of its collection demand.
 */
export async function replaceLandscapeMembership(
  landscapeId: string,
  companyIds: readonly string[],
): Promise<void> {
  const desiredIds = normalizedLandscapeMembers(companyIds);
  if (desiredIds.length === 0) {
    await db.delete(landscapeCompanies)
      .where(eq(landscapeCompanies.landscapeId, landscapeId));
    return;
  }

  const desiredRows = sql.join(
    desiredIds.map((companyId, sortOrder) => (
      sql`(${companyId}::uuid, ${sortOrder}::integer)`
    )),
    sql`, `,
  );

  await db.execute(sql`
    WITH desired (company_id, sort_order) AS MATERIALIZED (
      VALUES ${desiredRows}
    ),
    upserted AS (
      INSERT INTO landscape_companies (landscape_id, company_id, sort_order)
      SELECT ${landscapeId}::uuid, desired.company_id, desired.sort_order
        FROM desired
      ON CONFLICT (landscape_id, company_id) DO UPDATE
        SET sort_order = excluded.sort_order
      RETURNING company_id
    )
    DELETE FROM landscape_companies AS current
     WHERE current.landscape_id = ${landscapeId}::uuid
       AND (SELECT count(*) FROM upserted) >= 0
       AND NOT EXISTS (
         SELECT 1
           FROM desired
          WHERE desired.company_id = current.company_id
       )
  `);
}
