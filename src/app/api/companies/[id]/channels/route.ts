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
import { and, eq, or } from 'drizzle-orm';
import { apiHandler, requireRole, AuthError, HttpError } from '@/lib/session';
import { db } from '@/db';
import {
  channels,
  companies,
  landscapeCompanies,
  landscapes,
} from '@/db/schema';
import { PLATFORMS, type Platform } from '@/lib/types';
import { AdapterError } from '@/lib/adapters/types';
import { getAdapter, hasAdapter, UNIMPLEMENTED_REASONS } from '@/lib/adapters/registry';
import { publicProfileOnboardingUnavailableReason } from '@/lib/adapters/supported-platforms';
import {
  assertCompanyInOrg,
  assertCompanyNotSharedWithOtherOrgs,
} from '../../../_lib/org-scope';
import { publicSourceCredentials } from '@/lib/adapters/public-sources';
import { channelExternalIdentity, channelIdentityKey } from '@/lib/channel-identity';
import { mergePublicChannelMeta, sanitizePublicProfileMeta } from '@/lib/channel-profile-meta';

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

function unsupported(platform: Platform): never {
  const reason = UNIMPLEMENTED_REASONS[platform];
  throw new HttpError(
    422,
    'Data Dumpster cannot read ' + platform + ' yet.'
      + (reason ? ' ' + reason : '')
      + ' Add another supported public social channel instead.',
    'no_adapter',
  );
}

interface CanonicalChannelCandidate {
  id: string;
  companyId: string;
  companyName: string;
  identityKey: string;
  externalId: string | null;
  meta: Record<string, unknown>;
}

async function canonicalCandidates(input: {
  platform: Platform;
  identityKey: string;
  externalId: string | null;
}): Promise<CanonicalChannelCandidate[]> {
  return db
    .select({
      id: channels.id,
      companyId: channels.companyId,
      companyName: companies.name,
      identityKey: channels.identityKey,
      externalId: channels.externalId,
      meta: channels.meta,
    })
    .from(channels)
    .innerJoin(companies, eq(companies.id, channels.companyId))
    .where(and(
      eq(channels.platform, input.platform),
      or(
        eq(channels.identityKey, input.identityKey),
        input.externalId ? eq(channels.externalId, input.externalId) : undefined,
      ),
    ));
}

async function trackingOrgIdsForCompany(companyId: string): Promise<string[]> {
  const rows = await db
    .selectDistinct({ orgId: landscapes.orgId })
    .from(landscapeCompanies)
    .innerJoin(landscapes, eq(landscapes.id, landscapeCompanies.landscapeId))
    .where(eq(landscapeCompanies.companyId, companyId));
  return rows.map((row) => row.orgId).sort();
}

function chooseCanonicalChannel(
  candidates: readonly CanonicalChannelCandidate[],
  input: { companyId: string; identityKey: string; externalId: string | null },
): CanonicalChannelCandidate | null {
  const externalMatch = input.externalId
    ? candidates.find((candidate) => candidate.externalId === input.externalId)
    : undefined;
  const handleMatch = candidates.find((candidate) => candidate.identityKey === input.identityKey);

  if (externalMatch && handleMatch && externalMatch.id !== handleMatch.id) {
    throw new HttpError(
      409,
      'The verified platform id and normalized handle point to different pooled profiles. '
        + 'An operator must reconcile those records before this account can be attached.',
      'pooled_account_identity_conflict',
    );
  }

  const canonical = externalMatch ?? handleMatch ?? null;
  if (!canonical) return null;
  if (canonical.companyId !== input.companyId) {
    throw new HttpError(
      409,
      'That public account is already attached to ' + canonical.companyName
        + '. Move the pooled profile instead of collecting it a second time.',
      'pooled_account_conflict',
    );
  }
  if (
    handleMatch
    && input.externalId
    && handleMatch.externalId
    && handleMatch.externalId !== input.externalId
  ) {
    throw new HttpError(
      409,
      'That handle now resolves to a different platform account. An operator must review the '
        + 'existing pooled profile before its stable id can change.',
      'reassigned_handle',
    );
  }
  return canonical;
}

export const POST = apiHandler<{ id: string }>(async (req, ctx) => {
  const { orgId } = await requireRole('editor');
  const companyId = idSchema.parse((await ctx.params).id);
  await assertCompanyInOrg(companyId, orgId);

  const body = await readChannelRequest(req, addChannelSchema);
  if (!hasAdapter(body.platform)) unsupported(body.platform);
  const onboardingUnavailable = publicProfileOnboardingUnavailableReason(body.platform);
  if (onboardingUnavailable) {
    throw new HttpError(422, onboardingUnavailable, 'public_profile_onboarding_unavailable');
  }

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

  // Profile identity lands in a globally pooled row, so resolving it with an
  // org owner/admin token would leak private metadata before ingestion even
  // starts. Use the exact same public-source allowlist as the runner.
  const credentials = publicSourceCredentials(body.platform);

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

  const externalId = channelExternalIdentity(profile.externalId);
  const identityKey = channelIdentityKey(body.platform, profile.handle);
  const identity = { platform: body.platform, identityKey, externalId };
  let canonical = chooseCanonicalChannel(await canonicalCandidates(identity), {
    companyId,
    identityKey,
    externalId,
  });

  if (!canonical) {
    // Both global unique indexes participate, so a target-less conflict clause
    // is intentional. A concurrent writer wins and is re-read below.
    const [inserted] = await db.insert(channels).values({
      companyId,
      platform: body.platform,
      handle: profile.handle,
      identityKey,
      externalId,
      profileUrl: profile.profileUrl ?? null,
      avatarUrl: profile.avatarUrl ?? null,
      // Public rows are the only safe shared representation until private
      // owned insights have their own org-scoped tables.
      isOwned: false,
      active: true,
      meta: sanitizePublicProfileMeta(profile.meta ?? {}),
    }).onConflictDoNothing().returning({ id: channels.id });
    canonical = inserted
      ? {
          id: inserted.id,
          companyId,
          companyName: '',
          identityKey,
          externalId,
          meta: sanitizePublicProfileMeta(profile.meta ?? {}),
        }
      : chooseCanonicalChannel(await canonicalCandidates(identity), {
          companyId,
          identityKey,
          externalId,
        });
  }
  if (!canonical) throw new Error('Canonical channel insert did not return a pooled profile.');

  const [saved] = await db.update(channels).set({
    handle: profile.handle,
    identityKey,
    externalId,
    profileUrl: profile.profileUrl ?? null,
    avatarUrl: profile.avatarUrl ?? null,
    // Public metadata is safe to refresh. Global quarantine state and ownership
    // classification are operator controls and remain untouched here.
    meta: mergePublicChannelMeta(canonical.meta, sanitizePublicProfileMeta(profile.meta ?? {})),
  }).where(eq(channels.id, canonical.id)).returning();

  const { enqueueChannelCollection } = await import('@/lib/adapters/collection-queue');
  // A channel belongs to the pooled company, not only to the workspace that
  // discovered it. Register it immediately for every landscape already tracking
  // that company so foreign workspaces do not wait for a later global sweep.
  const trackingOrgIds = await trackingOrgIdsForCompany(companyId);
  const orderedOrgIds = [orgId, ...trackingOrgIds.filter((id) => id !== orgId)];
  let collectionQueued = 0;
  for (const trackingOrgId of orderedOrgIds) {
    collectionQueued = Math.max(
      collectionQueued,
      await enqueueChannelCollection({ channelId: saved.id, orgId: trackingOrgId }),
    );
  }

  return Response.json(
    {
      ...saved,
      displayName: profile.displayName ?? null,
      followers: profile.followers ?? null,
      collectionQueued: collectionQueued > 0,
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
