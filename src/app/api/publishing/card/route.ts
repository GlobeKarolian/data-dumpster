/** GET ?url=: the story's headline, summary and image, for the composer. */
import type { NextRequest } from 'next/server';
import { z } from 'zod';
import { apiHandler } from '@/lib/session';
import { requirePublishingUser } from '@/lib/publishing/guard';
import { fetchLinkPreview } from '@/lib/publishing/preview';
import { NO_STORE } from '../_shared';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const GET = apiHandler(async (req: NextRequest) => {
  await requirePublishingUser();
  const url = z.string().url().max(2000).parse(req.nextUrl.searchParams.get('url'));
  return Response.json({ card: await fetchLinkPreview(url) }, NO_STORE);
});
