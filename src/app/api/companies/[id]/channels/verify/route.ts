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
import { channels } from '@/db/schema';
import { PLATFORMS, type Platform } from '@/lib/types';
import { AdapterError } from '@/lib/adapters/types';
import { getAdapter, hasAdapter, UNIMPLEMENTED_REASONS } from '@/lib/adapters/registry';
import { readJson } from '../../../../_lib/query';
import { assertCompanyInOrg } from '../../../../_lib/org-scope';
import { loadCredentials } from '../../../../_lib/credentials';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
/** Vendor-backed resolution can take 30-60 seconds. */
export const maxDuration = 120;

const idSchema = z.uuid('That is not a company id.');

const verifySchema = z.object({
  platform: z.enum(PLATFORMS),
  input: z.string().trim().min(1).max(2000),
});

export interface VerifyWarning {
  code: 'tiny_audience' | 'no_content' | 'not_verified' | 'already_attached' | 'name_mismatch' | 'private';
  message: string;
  /** high means almost certainly the wrong account. */
  severity: 'high' | 'medium' | 'low';
}

/**
 * Heuristics for "this resolved, but it is probably not who you meant."
 *
 * Deliberately advisory rather than blocking. A small local outlet legitimately
 * has a few hundred followers, and refusing to add it would be worse than
 * asking. The severity ranking is what the UI uses to decide how loud to be.
 */
function assess(
  profile: { handle: string; displayName?: string; followers?: number; meta?: Record<string, unknown> },
  companyName: string,
  alreadyAttached: boolean,
): VerifyWarning[] {
  const out: VerifyWarning[] = [];
  const followers = profile.followers ?? 0;

  if (followers > 0 && followers < 100) {
    out.push({
      code: 'tiny_audience',
      severity: 'high',
      message: 'This account has only ' + followers.toLocaleString() + ' followers. Squatted and '
        + 'abandoned handles look exactly like this. Confirm it is really ' + companyName + '.',
    });
  } else if (followers >= 100 && followers < 1000) {
    out.push({
      code: 'tiny_audience',
      severity: 'medium',
      message: 'Only ' + followers.toLocaleString() + ' followers. Plausible for a small outlet, '
        + 'worth a look before saving.',
    });
  }

  const meta = profile.meta ?? {};
  if (meta.isVerified === false && followers > 10000) {
    out.push({
      code: 'not_verified',
      severity: 'low',
      message: 'Not a verified account, despite a sizeable following. Impersonation accounts are common '
        + 'for news brands.',
    });
  }
  if (meta.isPrivate === true) {
    out.push({
      code: 'private',
      severity: 'high',
      message: 'This account is private. Pressbox will not be able to read its posts.',
    });
  }

  // Loose name comparison. Newsroom brands rarely match exactly ("WBUR" vs
  // "WBUR 90.9"), so this only fires when there is no shared token at all.
  const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  const companyTokens = new Set(norm(companyName).split(' ').filter((t) => t.length > 2));
  const profileText = norm((profile.displayName ?? '') + ' ' + profile.handle);
  const overlap = [...companyTokens].some((t) => profileText.includes(t));
  if (companyTokens.size > 0 && !overlap) {
    out.push({
      code: 'name_mismatch',
      severity: 'medium',
      message: 'The account name (' + (profile.displayName ?? profile.handle) + ') shares no words with '
        + companyName + '.',
    });
  }

  if (alreadyAttached) {
    out.push({
      code: 'already_attached',
      severity: 'low',
      message: 'This channel is already attached. Saving will refresh it rather than duplicate it.',
    });
  }

  return out;
}

function unsupported(platform: Platform): never {
  const reason = UNIMPLEMENTED_REASONS[platform];
  throw new HttpError(
    422,
    'Pressbox cannot read ' + platform + ' yet.' + (reason ? ' ' + reason : ''),
    'no_adapter',
  );
}

export const POST = apiHandler<{ id: string }>(async (req, ctx) => {
  const { orgId } = await requireRole('editor');
  const companyId = idSchema.parse((await ctx.params).id);
  const company = await assertCompanyInOrg(companyId, orgId);

  const body = await readJson(req, verifySchema);
  if (!hasAdapter(body.platform)) unsupported(body.platform);
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

  const credentials = await loadCredentials(orgId, body.platform);

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

  const companyName = typeof company === 'object' && company !== null && 'name' in company
    ? String((company as { name: unknown }).name)
    : '';

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
    warnings: assess(profile, companyName, existing.length > 0),
  });
});
