/**
 * /api/companies/[id]/channels -- a company's presence on one platform.
 *
 * POST   { platform, input } where input is a handle OR a profile URL.
 * DELETE ?channelId=... or ?platform=... to detach one.
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
import { PLATFORMS, type Platform } from '@/lib/types';
import { AdapterError } from '@/lib/adapters/types';
import { getAdapter, hasAdapter, UNIMPLEMENTED_REASONS } from '@/lib/adapters/registry';
import { readJson } from '../../../_lib/query';
import { assertCompanyInOrg } from '../../../_lib/org-scope';
import { loadCredentials } from '../../../_lib/credentials';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const idSchema = z.uuid('That is not a company id.');

const addChannelSchema = z.object({
  platform: z.enum(PLATFORMS),
  /** A handle, an @handle, a profile URL, a feed URL, or a Bluesky DID. */
  input: z.string().trim().min(1).max(2000),
  /** Set when the org holds an owner token and can read private insights. */
  isOwned: z.boolean().default(false),
});

const removeChannelSchema = z.object({
  channelId: z.uuid().optional(),
  platform: z.enum(PLATFORMS).optional(),
}).refine((b) => b.channelId !== undefined || b.platform !== undefined,
  'Pass either channelId or platform.');

function unsupported(platform: Platform): never {
  const reason = UNIMPLEMENTED_REASONS[platform];
  throw new HttpError(
    422,
    'Data Dumpster cannot read ' + platform + ' yet.'
      + (reason ? ' ' + reason : '')
      + ' Where the outlet publishes a feed, add it as an RSS channel instead.',
    'no_adapter',
  );
}

export const POST = apiHandler<{ id: string }>(async (req, ctx) => {
  const { orgId } = await requireRole('editor');
  const companyId = idSchema.parse((await ctx.params).id);
  await assertCompanyInOrg(companyId, orgId);

  const body = await readJson(req, addChannelSchema);
  if (!hasAdapter(body.platform)) unsupported(body.platform);

  const adapter = getAdapter(body.platform);

  let handle: string;
  try {
    handle = adapter.parseHandle(body.input);
  } catch (err) {
    throw new HttpError(
      422,
      err instanceof AdapterError
        ? err.message
        : 'That does not look like a ' + adapter.displayName + ' handle or profile URL.',
      'unparseable_handle',
    );
  }

  const credentials = await loadCredentials(orgId, body.platform);

  let profile;
  try {
    profile = await adapter.resolveProfile(handle, credentials);
  } catch (err) {
    if (err instanceof AdapterError) {
      // Retryable means the platform is rate-limiting or down: that is a 503,
      // not the caller's fault. Anything else is a bad handle or bad key.
      throw new HttpError(
        err.opts.retryable ? 503 : 422,
        err.message,
        err.opts.retryable ? 'platform_unavailable' : 'unresolvable_handle',
      );
    }
    throw err;
  }

  // Upsert on (companyId, platform, handle) so re-adding a channel is a no-op
  // that refreshes the profile rather than a duplicate-key error in the UI.
  const [saved] = await db
    .insert(channels)
    .values({
      companyId,
      platform: body.platform,
      handle: profile.handle,
      externalId: profile.externalId,
      profileUrl: profile.profileUrl ?? null,
      avatarUrl: profile.avatarUrl ?? null,
      isOwned: body.isOwned,
      active: true,
      meta: profile.meta ?? {},
    })
    .onConflictDoUpdate({
      target: [channels.companyId, channels.platform, channels.handle],
      set: {
        externalId: profile.externalId,
        profileUrl: profile.profileUrl ?? null,
        avatarUrl: profile.avatarUrl ?? null,
        isOwned: body.isOwned,
        active: true,
        meta: profile.meta ?? {},
      },
    })
    .returning();

  return Response.json(
    {
      ...saved,
      displayName: profile.displayName ?? null,
      followers: profile.followers ?? null,
    },
    { status: 201 },
  );
});

export const DELETE = apiHandler<{ id: string }>(async (req, ctx) => {
  const { orgId } = await requireRole('editor');
  const companyId = idSchema.parse((await ctx.params).id);
  await assertCompanyInOrg(companyId, orgId);

  const sp = req.nextUrl.searchParams;
  const target = removeChannelSchema.parse({
    channelId: sp.get('channelId') ?? undefined,
    platform: sp.get('platform') ?? undefined,
  });

  const deleted = await db
    .delete(channels)
    .where(and(
      eq(channels.companyId, companyId),
      target.channelId ? eq(channels.id, target.channelId) : undefined,
      target.platform ? eq(channels.platform, target.platform) : undefined,
    ))
    .returning({ id: channels.id });

  if (deleted.length === 0) throw new AuthError('not_found', 'That channel does not exist.');
  return Response.json({ deleted: deleted.length });
});

/**
 * PATCH -- pause, resume, or reclassify a channel.
 *
 * Pausing rather than deleting matters. A handle that turns out to be wrong, or
 * a feed that starts 403ing, should stop being polled without losing the posts
 * already collected under it. Deleting cascades and takes the history with it,
 * which is rarely what someone means when they say "stop tracking this".
 */
const patchChannelSchema = z.object({
  channelId: z.uuid(),
  active: z.boolean().optional(),
  isOwned: z.boolean().optional(),
  /** Free-text note explaining a pause, surfaced in the UI. */
  reason: z.string().trim().max(500).optional(),
}).refine((b) => b.active !== undefined || b.isOwned !== undefined,
  'Pass active or isOwned.');

export const PATCH = apiHandler<{ id: string }>(async (req, ctx) => {
  const { orgId } = await requireRole('editor');
  const companyId = idSchema.parse((await ctx.params).id);
  await assertCompanyInOrg(companyId, orgId);

  const body = await readJson(req, patchChannelSchema);

  const [existing] = await db.select().from(channels)
    .where(and(eq(channels.id, body.channelId), eq(channels.companyId, companyId)));
  if (!existing) throw new AuthError('not_found', 'That channel does not exist.');

  const meta: Record<string, unknown> = { ...(existing.meta ?? {}) };
  if (body.active === false) {
    meta.disabledReason = body.reason ?? 'Paused from the Sources screen.';
    meta.disabledAt = new Date().toISOString();
  } else if (body.active === true) {
    delete meta.disabledReason;
    delete meta.disabledAt;
  }

  const [saved] = await db.update(channels)
    .set({
      ...(body.active === undefined ? {} : { active: body.active }),
      ...(body.isOwned === undefined ? {} : { isOwned: body.isOwned }),
      meta,
    })
    .where(eq(channels.id, body.channelId))
    .returning();

  return Response.json(saved);
});
