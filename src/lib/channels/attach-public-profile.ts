import 'server-only';

import { and, eq, or } from 'drizzle-orm';
import { db } from '@/db';
import { channels, companies, landscapeCompanies, landscapes } from '@/db/schema';
import { AdapterError, type AdapterProfile } from '@/lib/adapters/types';
import { getAdapter, hasAdapter, UNIMPLEMENTED_REASONS } from '@/lib/adapters/registry';
import { publicProfileOnboardingUnavailableReason } from '@/lib/adapters/supported-platforms';
import { publicSourceCredentials } from '@/lib/adapters/public-sources';
import { channelExternalIdentity, channelIdentityKey } from '@/lib/channel-identity';
import { mergePublicChannelMeta, sanitizePublicProfileMeta } from '@/lib/channel-profile-meta';
import { HttpError } from '@/lib/session';
import type { Platform } from '@/lib/types';

interface CanonicalChannelCandidate {
  id: string;
  companyId: string;
  companyName: string;
  handle: string;
  identityKey: string;
  externalId: string | null;
  profileUrl: string | null;
  avatarUrl: string | null;
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
      handle: channels.handle,
      identityKey: channels.identityKey,
      externalId: channels.externalId,
      profileUrl: channels.profileUrl,
      avatarUrl: channels.avatarUrl,
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

export interface AttachPublicProfileResult {
  channel: typeof channels.$inferSelect;
  profile: AdapterProfile;
  collectionQueued: boolean;
  /** Facebook identity is claimed by the first paid collection, not a duplicate preflight crawl. */
  identityPending: boolean;
}

/**
 * Resolve, globally deduplicate, attach and queue a public profile.
 *
 * Election rosters are allowed to stage a supplied Facebook URL without buying
 * a duplicate verification crawl. The normal runner still enforces the stable
 * platform-id gate before any observation can land.
 */
export async function attachPublicProfile(input: {
  companyId: string;
  orgId: string;
  platform: Platform;
  profileInput: string;
  allowDeferredFacebookIdentity?: boolean;
  /** Trusted profile already resolved from the same supplied URL in a paid batch. */
  resolvedProfile?: AdapterProfile;
}): Promise<AttachPublicProfileResult> {
  if (!hasAdapter(input.platform)) {
    const reason = UNIMPLEMENTED_REASONS[input.platform];
    throw new HttpError(
      422,
      'Data Dumpster cannot read ' + input.platform + ' yet.'
        + (reason ? ' ' + reason : ''),
      'no_adapter',
    );
  }

  const adapter = getAdapter(input.platform);
  let parsedHandle: string;
  try {
    parsedHandle = adapter.parseHandle(input.profileInput);
  } catch (error) {
    throw new HttpError(
      422,
      error instanceof AdapterError
        ? error.message
        : 'That does not look like a ' + adapter.displayName + ' handle or profile URL.',
      'unparseable_handle',
    );
  }

  const deferFacebookIdentity = input.platform === 'facebook'
    && input.allowDeferredFacebookIdentity === true;
  const onboardingUnavailable = publicProfileOnboardingUnavailableReason(input.platform);
  if (onboardingUnavailable && !deferFacebookIdentity) {
    throw new HttpError(422, onboardingUnavailable, 'public_profile_onboarding_unavailable');
  }

  let profile: AdapterProfile;
  if (input.resolvedProfile) {
    profile = input.resolvedProfile;
    const suppliedIdentity = channelIdentityKey(input.platform, parsedHandle);
    const resolvedIdentity = channelIdentityKey(input.platform, profile.handle);
    if (!channelExternalIdentity(profile.externalId) || suppliedIdentity !== resolvedIdentity) {
      throw new HttpError(
        422,
        'The pre-resolved profile does not match the supplied public profile URL.',
        'resolved_profile_mismatch',
      );
    }
  } else if (deferFacebookIdentity) {
    profile = {
      externalId: '',
      handle: parsedHandle,
      profileUrl: input.profileInput,
      meta: { source: 'supplied-election-roster' },
    };
  } else {
    try {
      profile = await adapter.resolveProfile(parsedHandle, publicSourceCredentials(input.platform));
    } catch (error) {
      if (error instanceof AdapterError) {
        throw new HttpError(
          error.opts.retryable ? 503 : 422,
          error.message,
          error.opts.retryable ? 'platform_unavailable' : 'unresolvable_handle',
        );
      }
      throw error;
    }
  }

  const externalId = channelExternalIdentity(profile.externalId);
  const identityKey = channelIdentityKey(input.platform, profile.handle);
  const identity = { platform: input.platform, identityKey, externalId };
  let canonical = chooseCanonicalChannel(await canonicalCandidates(identity), {
    companyId: input.companyId,
    identityKey,
    externalId,
  });

  if (!canonical) {
    const publicMeta = sanitizePublicProfileMeta(profile.meta ?? {});
    const [inserted] = await db.insert(channels).values({
      companyId: input.companyId,
      platform: input.platform,
      handle: profile.handle,
      identityKey,
      externalId,
      profileUrl: profile.profileUrl ?? input.profileInput,
      avatarUrl: profile.avatarUrl ?? null,
      isOwned: false,
      active: true,
      meta: publicMeta,
    }).onConflictDoNothing().returning({ id: channels.id });
    canonical = inserted
      ? {
          id: inserted.id,
          companyId: input.companyId,
          companyName: '',
          handle: profile.handle,
          identityKey,
          externalId,
          profileUrl: profile.profileUrl ?? input.profileInput,
          avatarUrl: profile.avatarUrl ?? null,
          meta: publicMeta,
        }
      : chooseCanonicalChannel(await canonicalCandidates(identity), {
          companyId: input.companyId,
          identityKey,
          externalId,
        });
  }
  if (!canonical) throw new Error('Canonical channel insert did not return a pooled profile.');

  const [saved] = await db.update(channels).set({
    handle: deferFacebookIdentity ? canonical.handle : profile.handle,
    identityKey,
    externalId: externalId ?? canonical.externalId,
    profileUrl: profile.profileUrl ?? canonical.profileUrl ?? input.profileInput,
    avatarUrl: profile.avatarUrl ?? canonical.avatarUrl,
    meta: mergePublicChannelMeta(canonical.meta, sanitizePublicProfileMeta(profile.meta ?? {})),
  }).where(eq(channels.id, canonical.id)).returning();

  const { enqueueChannelCollection } = await import('@/lib/adapters/collection-queue');
  const trackingOrgIds = await trackingOrgIdsForCompany(input.companyId);
  const orderedOrgIds = [input.orgId, ...trackingOrgIds.filter((id) => id !== input.orgId)];
  let collectionQueued = 0;
  for (const trackingOrgId of orderedOrgIds) {
    collectionQueued = Math.max(
      collectionQueued,
      await enqueueChannelCollection({ channelId: saved.id, orgId: trackingOrgId }),
    );
  }

  return {
    channel: saved,
    profile,
    collectionQueued: collectionQueued > 0,
    identityPending: externalId === null,
  };
}
