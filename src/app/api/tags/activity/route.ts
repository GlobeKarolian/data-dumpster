/**
 * GET /api/tags/activity — the tagging pipeline's recent output, for the live
 * view's polling. Read-only, org-scoped, no-store. The same function feeds
 * the live page's server render; see lib/tagging/activity.ts.
 */
import { apiHandler, requireOrg } from '@/lib/session';
import { getTagActivity } from '@/lib/tagging/activity';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const GET = apiHandler(async () => {
  const { orgId } = await requireOrg();
  return Response.json(await getTagActivity(orgId), {
    headers: { 'cache-control': 'no-store' },
  });
});
