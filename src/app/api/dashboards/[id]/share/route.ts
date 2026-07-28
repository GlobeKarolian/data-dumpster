/**
 * POST /api/dashboards/[id]/share -- mint or revoke a public link.
 *
 * Body: { "enabled": true } to mint, { "enabled": false } to revoke.
 *
 * Why a capability token rather than a login:
 * the people a newsroom most wants to hand a dashboard to -- an editor in chief,
 * a board member, an agency -- are exactly the people who will not create an
 * account to look at one chart. An unguessable URL is the pragmatic answer, and
 * it is the same trade Rival IQ and Looker make.
 *
 * The safeguards that make it defensible:
 *   - 21 characters of nanoid entropy, roughly 126 bits. Not brute-forceable.
 *   - Minting always issues a NEW token, so "share again" silently invalidates
 *     the previous link. Rotation is the only revocation story that works when
 *     you do not know who has the URL.
 *   - Revocation is a single null. The public route reads by token, so once it
 *     is gone the link is dead immediately, with no cache to wait out.
 *   - Only editors and above can mint. A viewer cannot widen access.
 */
import { z } from 'zod';
import { and, eq } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import { apiHandler, requireRole, AuthError } from '@/lib/session';
import { db } from '@/db';
import { dashboards } from '@/db/schema';
import { readJson } from '../../../_lib/query';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const idSchema = z.uuid('That is not a dashboard id.');
const shareSchema = z.object({ enabled: z.boolean() });

/** 21 chars of the URL-safe alphabet. Long enough that guessing is not a threat model. */
const TOKEN_LENGTH = 21;

export const POST = apiHandler<{ id: string }>(async (req, ctx) => {
  const { orgId } = await requireRole('editor');
  const id = idSchema.parse((await ctx.params).id);
  const { enabled } = await readJson(req, shareSchema);

  const shareToken = enabled ? nanoid(TOKEN_LENGTH) : null;

  const [updated] = await db
    .update(dashboards)
    .set({ shareToken, updatedAt: new Date() })
    .where(and(eq(dashboards.id, id), eq(dashboards.orgId, orgId)))
    .returning({ id: dashboards.id, shareToken: dashboards.shareToken });

  if (!updated) throw new AuthError('not_found', 'That dashboard does not exist.');

  return Response.json(
    {
      id: updated.id,
      isShared: updated.shareToken !== null,
      shareToken: updated.shareToken,
      shareUrl: updated.shareToken
        ? new URL('/share/' + updated.shareToken, req.nextUrl.origin).toString()
        : null,
    },
    { headers: { 'cache-control': 'no-store' } },
  );
});
