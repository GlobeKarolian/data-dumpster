/** GET /api/leakage/runs/:id: one saved run, reopened without spending X credits. */
import type { NextRequest } from 'next/server';
import { apiHandler, HttpError } from '@/lib/session';
import { requireLeakageUser } from '@/lib/leakage/guard';
import { getRun } from '@/lib/leakage/store';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const GET = apiHandler(async (_req: NextRequest, context: { params: Promise<{ id: string }> }) => {
  const session = await requireLeakageUser();
  const { id } = await context.params;
  if (!UUID.test(id)) throw new HttpError(404, 'Not found.', 'not_found');
  const run = await getRun(session.orgId, id);
  if (!run) throw new HttpError(404, 'Not found.', 'not_found');
  return new Response(JSON.stringify({
    runId: run.id,
    savedAt: run.created_at,
    story: run.story_key,
    storyUrl: run.story_url,
    window: run.window_label,
    queries: run.queries,
    summary: run.summary,
    accounts: run.accounts,
    posts: run.posts,
  }), { headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' } });
});
