/** GET: posts and their per-account deliveries in a date range. POST: compose. */
import type { NextRequest } from 'next/server';
import { z } from 'zod';
import { apiHandler } from '@/lib/session';
import { requirePublishingUser } from '@/lib/publishing/guard';
import { listPosts } from '@/lib/publishing/store';
import { composeSchema, createPost } from '@/lib/publishing/service';
import { NO_STORE } from '../_shared';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const range = z.object({
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional(),
});

export const GET = apiHandler(async (req: NextRequest) => {
  const s = await requirePublishingUser();
  const r = range.parse(Object.fromEntries(req.nextUrl.searchParams));
  const from = r.from ? new Date(r.from) : new Date(Date.now() - 2 * 86400_000);
  const to = r.to ? new Date(r.to) : new Date(Date.now() + 14 * 86400_000);
  return Response.json({ posts: await listPosts(s.orgId, from, to), canApprove: s.canApprove }, NO_STORE);
});

export const POST = apiHandler(async (req: NextRequest) => {
  const s = await requirePublishingUser();
  const input = composeSchema.parse(await req.json());
  const result = await createPost({ orgId: s.orgId, userId: s.userId, email: s.email, canApprove: s.canApprove }, input);
  return Response.json(result, { status: 201, ...NO_STORE });
});
