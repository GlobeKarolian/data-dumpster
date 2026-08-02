/**
 * GET /api/posts/[id]
 *
 * The on-demand record behind the Social Posts detail dialog. The collection
 * endpoint stays lean; channel metadata, tag provenance, destination metadata,
 * freshness and metric history are fetched only when a person opens one post.
 */
import { z } from 'zod';
import { apiHandler, AuthError, requireOrg } from '@/lib/session';
import { getPostDetail } from '@/lib/metrics/queries';
import { analyticsJson, resolveAnalyticsQuery } from '../../_lib/query';
import { readPostsParams } from '../../_lib/posts-params';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const postIdSchema = z.uuid('That is not a post id.');

export const GET = apiHandler<{ id: string }>(async (req, ctx) => {
  const { orgId } = await requireOrg();
  const postId = postIdSchema.parse((await ctx.params).id);
  const { query } = await resolveAnalyticsQuery(req, orgId);
  const paging = readPostsParams(req);
  const detail = await getPostDetail({ ...query, ...paging, postId });
  if (!detail) throw new AuthError('not_found', 'That post does not exist in this view.');
  return analyticsJson(detail);
});
