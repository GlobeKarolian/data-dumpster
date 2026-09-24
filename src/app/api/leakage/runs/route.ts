/** GET /api/leakage/runs: every saved Article Leakage run for the org, newest first. */
import { apiHandler } from '@/lib/session';
import { requireLeakageUser } from '@/lib/leakage/guard';
import { listRuns } from '@/lib/leakage/store';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const GET = apiHandler(async () => {
  const session = await requireLeakageUser();
  return Response.json({ runs: await listRuns(session.orgId) }, { headers: { 'cache-control': 'no-store' } });
});
