import { after } from 'next/server';
import { z } from 'zod';
import { apiHandler } from '@/lib/session';
import { assertCronAuthorized, cronJson } from '../../_lib/cron';
import { readJson } from '../../_lib/query';
import { runRefreshJobAndContinue } from '@/lib/adapters/refresh-dispatch';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

const bodySchema = z.object({ jobId: z.uuid() });

export const POST = apiHandler(async (req) => {
  assertCronAuthorized(req);
  const { jobId } = await readJson(req, bodySchema);

  after(() => runRefreshJobAndContinue(jobId));
  return cronJson({ accepted: true, jobId }, 202);
});
