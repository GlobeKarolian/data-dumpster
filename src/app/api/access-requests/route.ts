import type { NextRequest } from 'next/server';
import { z } from 'zod';
import { apiHandler, HttpError } from '@/lib/session';
import { submitAccessRequest } from '@/lib/access-requests';
import { absoluteOrigin } from '@/lib/origin';
import { checkRateLimit, LIMITS } from '@/app/api/_lib/rate-limit';
import { readJson } from '@/app/api/_lib/query';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const schema = z.object({
  name: z.string().trim().min(2, 'Enter your name.').max(120),
  email: z.string().trim().toLowerCase().email('Enter a valid email address.').max(320),
  team: z.string().trim().max(120).optional(),
  reason: z.string().trim().max(1_000).optional(),
  /** Hidden honeypot. A real person never sees or fills this. */
  website: z.string().max(0).optional(),
});

function clientKey(req: NextRequest): string {
  const forwarded = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim();
  const ip = forwarded ?? req.headers.get('x-real-ip') ?? 'unknown';
  return 'access-request:' + ip;
}

export const POST = apiHandler(async (req: NextRequest) => {
  const limited = checkRateLimit(clientKey(req), LIMITS.accessRequest);
  if (!limited.ok) {
    throw new HttpError(429, 'Too many requests. Try again later.', 'rate_limited');
  }

  const body = await readJson(req, schema);
  await submitAccessRequest({ ...body, origin: absoluteOrigin(req) });

  // Deliberately identical for a new request, a duplicate, or an existing
  // account. The public endpoint must not be an account-enumeration oracle.
  return Response.json(
    {
      ok: true,
      message: 'Your request is in. An administrator will review it and email you with the decision.',
    },
    { status: 202, headers: { 'cache-control': 'no-store' } },
  );
});
