/**
 * POST {url, targetIds}: read the story and draft one post per account with the
 * org's model (OpenRouter by default). Returns drafts plus any numbers or quotes
 * the story does not back up. Posts nothing.
 */
import type { NextRequest } from 'next/server';
import { z } from 'zod';
import { apiHandler } from '@/lib/session';
import { requirePublishingUser } from '@/lib/publishing/guard';
import { draftPosts } from '@/lib/publishing/drafting';
import { NO_STORE } from '../_shared';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 90;

const body = z.object({
  url: z.string().url().max(2000),
  targetIds: z.array(z.string().uuid()).min(1).max(30),
});

export const POST = apiHandler(async (req: NextRequest) => {
  const s = await requirePublishingUser();
  const { url, targetIds } = body.parse(await req.json());
  return Response.json(await draftPosts(s.orgId, url, targetIds), NO_STORE);
});
