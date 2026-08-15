/**
 * /api/companies/[id]/channels -- a company's presence on one platform.
 *
 * POST   { platform, input } where input is a handle OR a profile URL.
 * PATCH  is an admin-only global quarantine with explicit acknowledgement.
 * DELETE is disabled because public profile history is pooled and reusable.
 *
 * The whole point of accepting either form is that nobody who works in a
 * newsroom has a canonical handle in their head -- they have a browser tab open
 * on the profile. So the endpoint takes whatever was pasted, hands it to the
 * adapter's parseHandle, then resolves it against the live platform so that what
 * gets stored is a verified account and not a typo that silently ingests
 * nothing for six weeks.
 *
 * A platform with no adapter is a 422, not a 400 and not a 500: the request was
 * well-formed and the server is healthy, it is the entity that cannot be
 * processed. The response carries the specific reason from the adapter registry
 * (X charges for API access, Meta only serves token holders) because "not
 * supported" with no explanation generates a support ticket every time.
 */
import { z } from 'zod';
import { and, eq } from 'drizzle-orm';
import { apiHandler, requireRole, AuthError, HttpError } from '@/lib/session';
import { db } from '@/db';
import { channels } from '@/db/schema';
import { PLATFORMS } from '@/lib/types';
import {
  assertCompanyInOrg,
  assertCompaniesVisibleToUser,
  assertCompanyNotSharedWithOtherOrgs,
} from '../../../_lib/org-scope';
import { attachPublicProfile } from '@/lib/channels/attach-public-profile';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const idSchema = z.uuid('That is not a company id.');

const addChannelSchema = z.object({
  platform: z.enum(PLATFORMS),
  /** A handle, an @handle, a public profile URL, or a Bluesky DID. */
  input: z.string().trim().min(1).max(2000),
}).strict();

const OWNED_INSIGHTS_UNAVAILABLE =
  'Owned-channel insights are temporarily unavailable while Data Dumpster finishes isolating '
  + 'private account data from the shared public benchmark pool. Only supported '
  + 'competitor-comparable public profiles can be added right now.';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function rejectOwnedChannelRequest(raw: unknown): void {
  if (!isRecord(raw) || raw.isOwned !== true) return;
  throw new HttpError(409, OWNED_INSIGHTS_UNAVAILABLE, 'owned_insights_unavailable');
}

/** Strict request parsing with one explicit error for stale owned-mode clients. */
async function readChannelRequest<T>(req: Request, schema: z.ZodType<T>): Promise<T> {
  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    raw = undefined;
  }
  rejectOwnedChannelRequest(raw);
  return schema.parse(raw);
}

export const POST = apiHandler<{ id: string }>(async (req, ctx) => {
  const session = await requireRole('editor');
  const { orgId } = session;
  const companyId = idSchema.parse((await ctx.params).id);
  await assertCompanyInOrg(companyId, orgId);
  await assertCompaniesVisibleToUser([companyId], session);

  const body = await readChannelRequest(req, addChannelSchema);
  const result = await attachPublicProfile({
    companyId,
    orgId,
    platform: body.platform,
    profileInput: body.input,
  });

  return Response.json(
    {
      ...result.channel,
      displayName: result.profile.displayName ?? null,
      followers: result.profile.followers ?? null,
      collectionQueued: result.collectionQueued,
    },
    { status: 201 },
  );
});

export const DELETE = apiHandler(async () => {
  await requireRole('admin');
  throw new HttpError(
    405,
    'Pooled public profiles and their history cannot be deleted. Remove the company from a '
      + 'landscape to stop that landscape demanding collection.',
    'pooled_channel_delete_disabled',
  );
});

/**
 * PATCH -- globally quarantine or resume a public channel.
 *
 * Pausing rather than deleting matters. A handle that turns out to be wrong, or
 * a profile that starts 403ing, should stop being polled without losing the posts
 * already collected under it. Deleting cascades and takes the history with it,
 * which is rarely what someone means when they say "stop tracking this".
 */
const patchChannelSchema = z.object({
  channelId: z.uuid(),
  active: z.boolean(),
  /** Explicit acknowledgement that this affects every landscape and org. */
  scope: z.literal('global'),
  /** Operator note explaining a quarantine, surfaced in the UI. */
  reason: z.string().trim().max(500).optional(),
}).strict();

export const PATCH = apiHandler<{ id: string }>(async (req, ctx) => {
  const { orgId } = await requireRole('admin');
  const companyId = idSchema.parse((await ctx.params).id);
  await assertCompanyInOrg(companyId, orgId);
  await assertCompanyNotSharedWithOtherOrgs(companyId, orgId);

  const body = await readChannelRequest(req, patchChannelSchema);

  const [existing] = await db.select().from(channels)
    .where(and(eq(channels.id, body.channelId), eq(channels.companyId, companyId)));
  if (!existing) throw new AuthError('not_found', 'That channel does not exist.');

  const meta: Record<string, unknown> = { ...(existing.meta ?? {}) };
  if (body.active === false) {
    meta.disabledReason = body.reason ?? 'Globally quarantined by an administrator.';
    meta.disabledAt = new Date().toISOString();
  } else if (body.active === true) {
    delete meta.disabledReason;
    delete meta.disabledAt;
  }

  const [saved] = await db.update(channels)
    .set({
      active: body.active,
      meta,
    })
    .where(eq(channels.id, body.channelId))
    .returning();

  if (body.active === true) {
    const { enqueueChannelCollection } = await import('@/lib/adapters/collection-queue');
    await enqueueChannelCollection({ channelId: saved.id, orgId, force: true });
  }

  return Response.json(saved);
});
