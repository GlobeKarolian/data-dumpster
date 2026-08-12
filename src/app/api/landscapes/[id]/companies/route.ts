/**
 * Add one already-visible pooled company to a landscape.
 *
 * Membership is many-to-many: this inserts a new relationship without
 * removing the company from any other landscape or duplicating its profiles,
 * posts, snapshots, or collection history.
 */
import { z } from 'zod';
import { sql } from 'drizzle-orm';
import type { NextRequest } from 'next/server';
import { apiHandler, assertLandscapeAccessible, requireRole } from '@/lib/session';
import { db } from '@/db';
import { enqueueLandscapeCollection } from '@/lib/adapters/collection-queue';
import { assertCompaniesVisibleToUser } from '../../../_lib/org-scope';
import { readJson } from '../../../_lib/query';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const idSchema = z.uuid('That is not a landscape id.');
const addCompanySchema = z.object({ companyId: z.uuid() });

export const POST = apiHandler<{ id: string }>(async (req: NextRequest, ctx) => {
  const session = await requireRole('editor');
  const landscapeId = idSchema.parse((await ctx.params).id);
  await assertLandscapeAccessible(landscapeId, session);

  const { companyId } = await readJson(req, addCompanySchema);
  await assertCompaniesVisibleToUser([companyId], session);

  const result = await db.execute<{ company_id: string }>(sql`
    INSERT INTO landscape_companies (landscape_id, company_id, sort_order)
    VALUES (
      ${landscapeId}::uuid,
      ${companyId}::uuid,
      coalesce((
        SELECT max(existing.sort_order) + 1
          FROM landscape_companies existing
         WHERE existing.landscape_id = ${landscapeId}::uuid
      ), 0)
    )
    ON CONFLICT (landscape_id, company_id) DO NOTHING
    RETURNING company_id
  `);

  let collectionQueued = 0;
  if (result.rows.length > 0) {
    try {
      const until = new Date();
      const collection = await enqueueLandscapeCollection({
        orgId: session.orgId,
        landscapeId,
        since: new Date(until.getTime() - 90 * 86_400_000),
        until,
      });
      collectionQueued = collection.queued;
    } catch (error) {
      // The membership is durable. Collection reconciliation is idempotent,
      // and the next scheduled refresh can safely repair this demand.
      console.error('[data-dumpster:landscape] company membership enqueue failed', error);
    }
  }

  return Response.json({
    companyId,
    landscapeId,
    added: result.rows.length > 0,
    collectionQueued,
  });
});
