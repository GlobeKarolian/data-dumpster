/** GET /api/leakage/leakers: accounts sharing archive or bypass copies across every checked story. */
import { apiHandler } from '@/lib/session';
import { requireLeakageUser } from '@/lib/leakage/guard';
import { repeatLeakers } from '@/lib/leakage/store';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const GET = apiHandler(async () => {
  const session = await requireLeakageUser();
  return new Response(JSON.stringify({ leakers: await repeatLeakers(session.orgId) }), {
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  });
});
