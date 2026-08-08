/**
 * /api/companies/[id]/channels/verify -- resolve a handle WITHOUT saving it.
 *
 * WHY THIS EXISTS
 * The add endpoint already resolves a handle against the live platform before
 * storing it, which catches typos that do not exist at all. It does not catch
 * the worse failure: a handle that resolves perfectly to the wrong account.
 * A squatted username with four followers and no videos is a valid account. It
 * stores cleanly, ingests cleanly, and then sits in a leaderboard for six weeks
 * looking like a competitor who published nothing.
 *
 * That happened during setup. The fix is not more validation, it is showing the
 * human what the machine found and making them confirm it. This endpoint returns
 * the resolved profile plus a list of reasons to be suspicious, and the UI
 * refuses to save until someone has looked at it.
 */
import { z } from 'zod';
import { and, eq } from 'drizzle-orm';
import { apiHandler, requireRole, HttpError } from '@/lib/session';
import { db } from '@/db';
import { channels, companies } from '@/db/schema';
import { PLATFORMS, type Platform } from '@/lib/types';
import { AdapterError } from '@/lib/adapters/types';
import { getAdapter, hasAdapter, UNIMPLEMENTED_REASONS } from '@/lib/adapters/registry';
import { publicProfileOnboardingUnavailableReason } from '@/lib/adapters/supported-platforms';
import { assessProfileMatch } from '@/lib/profile-verification';
import { publicSourceCredentials } from '@/lib/adapters/public-sources';
import { readJson } from '../../../../_lib/query';
import {
  assertCompaniesVisibleToUser,
  assertCompanyInOrg,
} from '../../../../_lib/org-scope';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
/** Vendor-backed resolution can take 30-60 seconds. */
export const maxDuration = 120;

const idSchema = z.uuid('That is not a company id.');

const verifySchema = z.object({
  platform: z.enum(PLATFORMS),
  input: z.string().trim().min(1).max(2000),
});

function unsupported(platform: Platform): never {
  const reason = UNIMPLEMENTED_REASONS[platform];
  throw new HttpError(
    422,
    'Data Dumpster cannot read ' + platform + ' yet.' + (reason ? ' ' + reason : ''),
    'no_adapter',
  );
}

export const POST = apiHandler<{ id: string }>(async (req, ctx) => {
  const session = await requireRole('editor');
  const { orgId } = session;
  const companyId = idSchema.parse((await ctx.params).id);
  await assertCompanyInOrg(companyId, orgId);
  await assertCompaniesVisibleToUser([companyId], session);
  const [company] = await db
    .select({ name: companies.name })
    .from(companies)
    .where(eq(companies.id, companyId))
    .limit(1);

  const body = await readJson(req, verifySchema);
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
      err instanceof AdapterError ? err.message
        : 'That does not look like a ' + adapter.displayName + ' handle or profile URL.',
      'unparseable_handle',
    );
  }

  // This profile is shown immediately and then persisted on confirmation.
  // Resolve only through deployment public sources; workspace owner/admin
  // credentials must never influence shared identity or metadata.
  const credentials = publicSourceCredentials(body.platform);

  let profile;
  try {
    profile = await adapter.resolveProfile(handle, credentials);
  } catch (err) {
    if (err instanceof AdapterError) {
      throw new HttpError(
        err.opts.retryable ? 503 : 422,
        err.message,
        err.opts.retryable ? 'platform_unavailable' : 'unresolvable_handle',
      );
    }
    throw err;
  }

  const existing = await db.select({ id: channels.id }).from(channels).where(and(
    eq(channels.companyId, companyId),
    eq(channels.platform, body.platform),
    eq(channels.handle, profile.handle),
  ));

  return Response.json({
    platform: body.platform,
    handle: profile.handle,
    externalId: profile.externalId,
    displayName: profile.displayName ?? null,
    avatarUrl: profile.avatarUrl ?? null,
    profileUrl: profile.profileUrl ?? null,
    followers: profile.followers ?? null,
    meta: profile.meta ?? {},
    alreadyAttached: existing.length > 0,
    warnings: assessProfileMatch(profile, company?.name ?? '', existing.length > 0, body.platform),
  });
});
