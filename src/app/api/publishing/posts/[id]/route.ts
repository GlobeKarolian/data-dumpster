/** PATCH {action}: approve (admins) or cancel a post and all its unsent deliveries. */
import type { NextRequest } from 'next/server';
import { z } from 'zod';
import { apiHandler, HttpError } from '@/lib/session';
import { requirePublishingUser } from '@/lib/publishing/guard';
import { approvePost, cancelPost } from '@/lib/publishing/service';
import { getPost } from '@/lib/publishing/store';
import { NO_STORE } from '../../_shared';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const body = z.object({ action: z.enum(['approve', 'cancel']) });

export const PATCH = apiHandler<{ id: string }>(async (req: NextRequest, ctx) => {
  const s = await requirePublishingUser();
  const id = z.string().uuid().parse((await ctx.params).id);
  const { action } = body.parse(await req.json());
  const post = await getPost(s.orgId, id);
  if (!post) throw new HttpError(404, 'Post not found.', 'not_found');
  if (action === 'approve') {
    if (!s.canApprove) throw new HttpError(403, 'Only admins can approve posts.', 'forbidden');
    await approvePost(s.orgId, id, s.email);
  } else {
    // Editors may withdraw their own submissions; admins may cancel anything.
    if (!s.canApprove && post.created_by_email !== s.email) throw new HttpError(403, 'You can only cancel your own posts.', 'forbidden');
    await cancelPost(s.orgId, id);
  }
  return Response.json({ post: await getPost(s.orgId, id) }, NO_STORE);
});
