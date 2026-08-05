import { z } from 'zod';
import { apiHandler, HttpError, requireRole } from '@/lib/session';
import { getRefreshJobForOrg } from '@/lib/adapters/refresh-jobs';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const paramsSchema = z.object({ id: z.uuid() });

export const GET = apiHandler<{ id: string }>(async (_req, { params }) => {
  const { orgId } = await requireRole('editor');
  const { id } = paramsSchema.parse(await params);
  const job = await getRefreshJobForOrg(id, orgId);
  if (!job) throw new HttpError(404, 'Refresh job not found.', 'refresh_job_not_found');
  return Response.json({ job }, { headers: { 'cache-control': 'private, no-store' } });
});
