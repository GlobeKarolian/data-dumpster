/**
 * /api/cron/groups — collect posts from watched public Facebook groups.
 *
 * One tick per org that has active watched groups, on its own schedule so a
 * slow group crawl never delays brand refresh or tagging. The Bright Data key
 * is the same deployment credential used for brand Facebook collection.
 */
import type { NextRequest } from 'next/server';
import { sql } from 'drizzle-orm';
import { apiHandler } from '@/lib/session';
import { db } from '@/db';
import { assertCronAuthorized, cronJson } from '../../_lib/cron';
import { readControl } from '@/lib/controls';
import { publicSourceCredentials } from '@/lib/adapters/public-sources';
import { runGroupCollection, type GroupCollectResult } from '@/lib/groups/collect';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

async function handle(req: NextRequest): Promise<Response> {
  assertCronAuthorized(req);
  if (!(await readControl('groups')).enabled) {
    return cronJson({ skipped: 'group collection is switched off by operator control' });
  }
  const apiKey = publicSourceCredentials('facebook').brightDataApiKey;
  if (!apiKey) {
    return cronJson({ skipped: 'no Bright Data credential configured' });
  }

  const { rows: orgs } = await db.execute<{ org_id: string }>(sql`
    SELECT DISTINCT org_id::text AS org_id
      FROM watched_groups WHERE active`);

  const results: (GroupCollectResult & { orgId: string })[] = [];
  for (const { org_id: orgId } of orgs) {
    try {
      results.push({ orgId, ...await runGroupCollection(orgId, apiKey) });
    } catch (error) {
      console.error('[data-dumpster:cron/groups] org tick failed', {
        orgId,
        error: error instanceof Error ? error.message : 'Unknown group collection failure.',
      });
    }
  }
  return cronJson({
    orgs: orgs.length,
    results: results.map((r) => ({
      orgId: r.orgId,
      claimed: r.groupsClaimed,
      posts: r.postsWritten,
      covered: r.covered,
      ineligible: r.ineligible,
      failed: r.failed,
      // Records bought is the number that maps to the invoice, and it is not
      // the same as posts stored. Surfaced on every tick so a runaway is
      // visible in the cron log rather than only on the vendor's dashboard a
      // day later, which is how a $232 round went unnoticed.
      recordsBought: r.recordsBought,
      estimatedCents: r.estimatedCents,
      budgetExhausted: r.budgetExhausted,
    })),
  });
}

export const GET = apiHandler(handle);
export const POST = apiHandler(handle);
