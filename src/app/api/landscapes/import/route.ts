import { z } from 'zod';
import { and, eq, inArray, sql } from 'drizzle-orm';
import type { NextRequest } from 'next/server';
import { db } from '@/db';
import {
  channels,
  companies,
  landscapeCompanies,
  landscapes,
  userLandscapeAccess,
} from '@/db/schema';
import { getAdapter } from '@/lib/adapters/registry';
import {
  parseLandscapeImportCsv,
  type LandscapeImportAccountPlan,
  type LandscapeImportCompanyPlan,
  type LandscapeImportIssue,
  type LandscapeImportPlan,
  type LandscapeImportPlatform,
  type LandscapeImportPreview,
  type LandscapeImportResult,
} from '@/lib/landscape-import';
import {
  apiHandler,
  hasRole,
  HttpError,
  requireRole,
  type OrgContext,
} from '@/lib/session';
import type { Platform } from '@/lib/types';
import { slugify } from '@/lib/utils';
import { channelIdentityKey } from '@/lib/channel-identity';
import { readJson } from '../../_lib/query';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const previewBodySchema = z.object({
  action: z.literal('preview'),
  csv: z.string().min(1, 'CSV is required.'),
  landscapeName: z.string().trim().min(1).max(120).optional(),
  focusCompanyKey: z.string().trim().min(1).max(160).optional(),
});

const importBodySchema = z.object({
  action: z.literal('import'),
  csv: z.string().min(1, 'CSV is required.'),
  landscapeName: z.string().trim().min(1).max(120),
  focusCompanyKey: z.string().trim().min(1).max(160),
});

const requestSchema = z.discriminatedUnion('action', [previewBodySchema, importBodySchema]);

type ImportRequest = z.infer<typeof requestSchema>;

interface ExistingCompany {
  id: string;
  name: string;
  slug: string;
  orgId: string | null;
  website: string | null;
}

interface ExistingChannel {
  id: string;
  companyId: string;
  companyName: string;
  platform: Platform;
  handle: string;
  identityKey: string;
}

interface ExistingLandscape {
  id: string;
  name: string;
  slug: string;
  focusCompanyId: string | null;
}

interface ChannelToCreate {
  companyId: string;
  platform: LandscapeImportPlatform;
  handle: string;
  profileUrl: string | null;
}

export type LandscapeImportPreviewResponse = LandscapeImportPlan;
export type LandscapeImportSuccessResponse = LandscapeImportResult;
export type LandscapeImportResponse =
  | LandscapeImportPreviewResponse
  | LandscapeImportSuccessResponse;

function importPlatform(platform: Platform): platform is LandscapeImportPlatform {
  return platform !== 'rss';
}

function canonicalStoredHandle(platform: Platform, handle: string): string {
  if (!importPlatform(platform)) return handle;
  try {
    return getAdapter(platform).parseHandle(handle);
  } catch {
    return handle.trim();
  }
}

function identityHandle(platform: Platform, handle: string): string {
  const canonical = canonicalStoredHandle(platform, handle);
  return channelIdentityKey(platform, canonical);
}

function unique<T>(values: readonly T[]): T[] {
  return [...new Set(values)];
}

function websiteHostname(value: string): string | null {
  try {
    return new URL(value).hostname.toLowerCase().replace(/^www\./, '');
  } catch {
    return null;
  }
}

function appendIssue(
  target: LandscapeImportIssue[],
  issue: LandscapeImportIssue,
): void {
  if (target.some((candidate) =>
    candidate.row === issue.row
    && candidate.column === issue.column
    && candidate.code === issue.code
    && candidate.message === issue.message)) return;
  target.push(issue);
}

/**
 * Lock each normalized public account identity for the duration of one
 * statement, recheck global ownership after those locks are held, and insert
 * either every requested channel or none. Advisory locks make the ownership
 * decision deterministic; the targetless conflict handler then defers to both
 * global identity constraints without naming an index that a migration removed.
 */
async function insertChannelsWithoutOwnershipRace(
  requested: ChannelToCreate[],
): Promise<{ inserted: number; conflicts: number }> {
  if (requested.length === 0) return { inserted: 0, conflicts: 0 };

  const requestedRows = sql.join(requested.map((channel) => {
    const identity = channelIdentityKey(channel.platform, channel.handle);
    return sql`(
      ${channel.companyId}::uuid,
      ${channel.platform}::platform,
      ${channel.handle}::text,
      ${channel.profileUrl}::text,
      ${identity}::text
    )`;
  }), sql`, `);

  const result = await db.execute<{
    inserted_count: number | string;
    conflict_count: number | string;
  }>(sql`
    WITH requested (company_id, platform, handle, profile_url, identity) AS MATERIALIZED (
      VALUES ${requestedRows}
    ),
    identity_locks AS MATERIALIZED (
      SELECT pg_advisory_xact_lock(hashtextextended(lock_key, 0))
      FROM (
        SELECT DISTINCT platform::text || chr(31) || identity AS lock_key
        FROM requested
        ORDER BY lock_key
      ) ordered_locks
    ),
    lock_barrier AS MATERIALIZED (
      SELECT count(*) AS held FROM identity_locks
    ),
    ownership_conflicts AS MATERIALIZED (
      SELECT requested.company_id, requested.platform, requested.handle
      FROM requested
      CROSS JOIN lock_barrier
      INNER JOIN channels existing
        ON existing.platform = requested.platform
       AND existing.identity_key = requested.identity
       AND existing.company_id <> requested.company_id
    ),
    inserted AS (
      INSERT INTO channels (
        company_id, platform, handle, identity_key, profile_url, is_owned, active, meta
      )
      SELECT requested.company_id,
             requested.platform,
             requested.handle,
             requested.identity,
             requested.profile_url,
             false,
             true,
             '{"importedFrom":"landscape-csv","verificationStatus":"not-live-verified"}'::jsonb
      FROM requested
      CROSS JOIN lock_barrier
      WHERE NOT EXISTS (SELECT 1 FROM ownership_conflicts)
      ON CONFLICT DO NOTHING
      RETURNING id
    )
    SELECT (SELECT count(*)::integer FROM inserted) AS inserted_count,
           (SELECT count(*)::integer FROM ownership_conflicts) AS conflict_count
  `);

  const row = result.rows[0];
  return {
    inserted: Number(row?.inserted_count) || 0,
    conflicts: Number(row?.conflict_count) || 0,
  };
}

async function loadExistingChannels(
  companyIds: string[],
  parsed: LandscapeImportPreview,
): Promise<ExistingChannel[]> {
  const accounts = parsed.accounts;
  const identities = unique(accounts.map((account) =>
    channelIdentityKey(account.platform, account.handle)));

  const [companyChannels, identityChannels] = await Promise.all([
    companyIds.length === 0
      ? Promise.resolve([])
      : db
        .select({
          id: channels.id,
          companyId: channels.companyId,
          companyName: companies.name,
          platform: channels.platform,
          handle: channels.handle,
          identityKey: channels.identityKey,
        })
        .from(channels)
        .innerJoin(companies, eq(companies.id, channels.companyId))
        .where(inArray(channels.companyId, companyIds)),
    identities.length === 0
      ? Promise.resolve([])
      : db
        .select({
          id: channels.id,
          companyId: channels.companyId,
          companyName: companies.name,
          platform: channels.platform,
          handle: channels.handle,
          identityKey: channels.identityKey,
        })
        .from(channels)
        .innerJoin(companies, eq(companies.id, channels.companyId))
        .where(inArray(channels.identityKey, identities)),
  ]);

  return [...new Map(
    [...companyChannels, ...identityChannels].map((channel) => [channel.id, channel]),
  ).values()];
}

async function buildPlan(
  parsed: LandscapeImportPreview,
  orgId: string,
  landscapeName?: string,
): Promise<LandscapeImportPlan> {
  const slugs = parsed.companies.map((company) => company.slug);
  const landscapeSlug = landscapeName ? slugify(landscapeName) : '';
  if (landscapeName && !landscapeSlug) {
    throw new HttpError(422, 'Landscape name has no usable characters.', 'invalid_name');
  }

  const [existingCompanies, existingLandscapeRows] = await Promise.all([
    slugs.length === 0
      ? Promise.resolve([])
      : db
        .select({
          id: companies.id,
          name: companies.name,
          slug: companies.slug,
          orgId: companies.orgId,
          website: companies.website,
        })
        .from(companies)
        .where(inArray(companies.slug, slugs)),
    !landscapeSlug
      ? Promise.resolve([])
      : db
        .select({
          id: landscapes.id,
          name: landscapes.name,
          slug: landscapes.slug,
          focusCompanyId: landscapes.focusCompanyId,
        })
        .from(landscapes)
        .where(and(eq(landscapes.orgId, orgId), eq(landscapes.slug, landscapeSlug)))
        .limit(1),
  ]);

  const companyBySlug = new Map(
    (existingCompanies as ExistingCompany[]).map((company) => [company.slug, company]),
  );
  const existingChannels = await loadExistingChannels(
    (existingCompanies as ExistingCompany[]).map((company) => company.id),
    parsed,
  );
  const errors = [...parsed.errors];
  const warnings = [...parsed.warnings];
  const plannedCompanies: LandscapeImportCompanyPlan[] = parsed.companies.map((company) => {
    const existing = companyBySlug.get(company.slug) ?? null;
    if (existing && existing.name !== company.name) {
      appendIssue(warnings, {
        row: company.rows[0],
        column: 'company',
        code: 'pooled_company_name',
        message: `"${company.name}" will reuse pooled company "${existing.name}" because both use slug ${company.slug}.`,
      });
    }
    if (existing?.website && company.website && existing.website !== company.website) {
      const existingHost = websiteHostname(existing.website);
      const importedHost = websiteHostname(company.website);
      appendIssue(existingHost && importedHost && existingHost !== importedHost ? errors : warnings, {
        row: company.rows[0],
        column: 'website',
        code: existingHost && importedHost && existingHost !== importedHost
          ? 'pooled_company_identity_conflict'
          : 'pooled_company_website',
        message: existingHost && importedHost && existingHost !== importedHost
          ? `"${company.name}" matches pooled company "${existing.name}" by name, but their website domains differ (${importedHost} versus ${existingHost}). Rename the CSV company or resolve the pooled record before importing.`
          : `"${existing.name}" already has a different URL on the same website. Existing pooled metadata will be preserved.`,
      });
    }

    const accountPlans: LandscapeImportAccountPlan[] = company.accounts.map((account) => {
      const matches = existingChannels.filter((channel) =>
        channel.platform === account.platform
        && channel.identityKey === identityHandle(account.platform, account.handle));
      const sameCompany = existing
        ? matches.filter((channel) => channel.companyId === existing.id)
        : [];
      const otherCompanies = matches.filter((channel) => channel.companyId !== existing?.id);

      if (otherCompanies.length > 0) {
        const ownerNames = unique(otherCompanies.map((channel) => channel.companyName));
        appendIssue(errors, {
          row: account.row,
          column: account.column,
          code: 'pooled_account_conflict',
          message: `${account.platform} account ${account.handle} is already attached to ${ownerNames.join(', ')}. Rename this row's company to "${ownerNames[0]}" to reuse that company instead of creating a duplicate.`,
        });
        return {
          ...account,
          action: 'conflict',
          existingChannelId: otherCompanies[0].id,
          existingCompanyId: otherCompanies[0].companyId,
          existingCompanyName: otherCompanies[0].companyName,
        };
      }

      if (sameCompany.length > 0) {
        if (sameCompany.length > 1) {
          appendIssue(warnings, {
            row: account.row,
            column: account.column,
            code: 'duplicate_pooled_account',
            message: `${account.platform} account ${account.handle} already has duplicate stored channels. The existing channel will be reused.`,
          });
        }
        return {
          ...account,
          action: 'reuse',
          existingChannelId: sameCompany[0].id,
          existingCompanyId: sameCompany[0].companyId,
          existingCompanyName: sameCompany[0].companyName,
        };
      }

      return {
        ...account,
        action: 'create',
        existingChannelId: null,
        existingCompanyId: existing?.id ?? null,
        existingCompanyName: existing?.name ?? null,
      };
    });
    if (existing && existing.orgId !== orgId) {
      const existingHost = existing.website ? websiteHostname(existing.website) : null;
      const importedHost = company.website ? websiteHostname(company.website) : null;
      const domainsMatch = Boolean(
        existingHost && importedHost && existingHost === importedHost,
      );
      const domainsConflict = Boolean(
        existingHost && importedHost && existingHost !== importedHost,
      );
      const accountMatches = accountPlans.some((account) => account.action === 'reuse');
      if (!domainsMatch && !domainsConflict && !accountMatches) {
        appendIssue(errors, {
          row: company.rows[0],
          column: company.website ? 'website' : 'company',
          code: 'pooled_company_identity_unverified',
          message: `"${company.name}" matches a pooled company by name, but the CSV does not provide a matching website domain or social account. Add one so Data Dumpster can verify it is the same outlet.`,
        });
      }
      for (const account of accountPlans) {
        if (account.action !== 'create') continue;
        appendIssue(errors, {
          row: account.row,
          column: account.column,
          code: 'shared_company_account_unverified',
          message: `${account.platform} account ${account.handle} is not already attached to shared company "${existing.name}". Only that company’s managing workspace can add new profiles.`,
        });
      }
    }

    return {
      ...company,
      action: existing ? 'reuse' : 'create',
      existingCompanyId: existing?.id ?? null,
      existingName: existing?.name ?? null,
      accounts: accountPlans,
    };
  });

  const accounts = plannedCompanies.flatMap((company) => company.accounts);
  const existingLandscape = (existingLandscapeRows as ExistingLandscape[])[0] ?? null;
  if (existingLandscape) {
    appendIssue(errors, {
      row: 0,
      column: 'landscapeName',
      code: 'duplicate_landscape',
      message: `A landscape named "${existingLandscape.name}" already exists. Choose a different name.`,
    });
  }

  return {
    ...parsed,
    companies: plannedCompanies,
    accounts,
    errors,
    warnings,
    canImport: errors.length === 0,
    counts: {
      ...parsed.counts,
      errors: errors.length,
      warnings: warnings.length,
    },
    landscape: landscapeName
      ? {
        name: landscapeName,
        slug: landscapeSlug,
        action: existingLandscape ? 'conflict' : 'create',
        existingLandscapeId: existingLandscape?.id ?? null,
        existingFocusCompanyId: existingLandscape?.focusCompanyId ?? null,
      }
      : null,
  };
}

function invalidImport(plan: LandscapeImportPlan, status = 422): Response {
  return Response.json(
    {
      error: 'The CSV has issues that must be fixed before it can be imported.',
      code: 'invalid_landscape_import',
      ...plan,
    },
    { status, headers: { 'cache-control': 'private, no-store' } },
  );
}

async function commitImport(
  request: Extract<ImportRequest, { action: 'import' }>,
  actor: OrgContext,
  initialPlan: LandscapeImportPlan,
): Promise<Response> {
  const { orgId } = actor;
  const focusCompany = initialPlan.companies.find(
    (company) => company.key === request.focusCompanyKey,
  );
  if (!focusCompany) {
    appendIssue(initialPlan.errors, {
      row: 1,
      column: 'focus',
      code: 'unknown_focus_company',
      message: 'The selected focus company is not present in this CSV.',
    });
    initialPlan.counts.errors = initialPlan.errors.length;
    initialPlan.canImport = false;
    return invalidImport(initialPlan);
  }
  if (initialPlan.landscape?.existingLandscapeId) {
    throw new HttpError(
      409,
      'A landscape with that name already exists. Choose a different name.',
      'duplicate_landscape',
    );
  }
  if (!initialPlan.canImport) return invalidImport(initialPlan);

  const companiesToCreate = initialPlan.companies.filter((company) => company.action === 'create');
  let companiesCreated = 0;
  if (companiesToCreate.length > 0) {
    const inserted = await db
      .insert(companies)
      .values(companiesToCreate.map((company) => ({
        orgId,
        name: company.name,
        slug: company.slug,
        website: company.website,
        segment: company.segment,
        color: company.color,
      })))
      .onConflictDoNothing({ target: companies.slug })
      .returning({ id: companies.id });
    companiesCreated = inserted.length;
  }

  // A concurrent import may have created a slug or channel after preview. Rebuild
  // the plan before attaching accounts so a retry remains safe and conflicts are
  // caught against the current pooled state.
  const currentPlan = await buildPlan(
    parseLandscapeImportCsv(request.csv),
    orgId,
    request.landscapeName,
  );
  if (!currentPlan.canImport) return invalidImport(currentPlan, 409);

  const companyIdByKey = new Map(
    currentPlan.companies.map((company) => [company.key, company.existingCompanyId]),
  );
  if ([...companyIdByKey.values()].some((id) => !id)) {
    throw new Error('Company upsert did not return every imported company.');
  }

  const channelsToCreate = currentPlan.companies.flatMap((company) => {
    const companyId = companyIdByKey.get(company.key);
    if (!companyId) return [];
    return company.accounts
      .filter((account) => account.action === 'create')
      .map((account) => ({
        companyId,
        platform: account.platform,
        handle: account.handle,
        profileUrl: account.profileUrl,
      }));
  });

  const channelInsert = await insertChannelsWithoutOwnershipRace(channelsToCreate);
  if (channelInsert.conflicts > 0) {
    const conflictPlan = await buildPlan(
      parseLandscapeImportCsv(request.csv),
      orgId,
      request.landscapeName,
    );
    if (conflictPlan.errors.length > 0) return invalidImport(conflictPlan, 409);
    throw new HttpError(
      409,
      'Another import attached one of these accounts to a different company. Preview the CSV again.',
      'pooled_account_conflict',
    );
  }
  const accountsAdded = channelInsert.inserted;

  const focusCompanyId = companyIdByKey.get(request.focusCompanyKey);
  if (!focusCompanyId) throw new Error('The selected focus company was not upserted.');
  const orderedIds = currentPlan.companies.map((company) => {
    const id = companyIdByKey.get(company.key);
    if (!id) throw new Error('An imported company was not upserted.');
    return id;
  });
  const orderedWithFocus = [
    focusCompanyId,
    ...orderedIds.filter((companyId) => companyId !== focusCompanyId),
  ];
  const desiredMembers = sql.join(
    orderedWithFocus.map((companyId, index) => sql`(${companyId}::uuid, ${index}::integer)`),
    sql`, `,
  );
  const landscapeSlug = slugify(request.landscapeName);

  // Companies and channels are pooled, so a failure before this statement can
  // leave only reusable public entities. The org-private landscape, focus and
  // membership land in one Postgres statement and therefore become visible
  // together even though neon-http does not support callback transactions.
  const committed = await db.execute<{
    id: string;
    name: string;
    slug: string;
    members_added: number | string;
  }>(sql`
    WITH target_landscape AS (
      INSERT INTO landscapes (org_id, name, slug, focus_company_id)
      VALUES (${orgId}::uuid, ${request.landscapeName}, ${landscapeSlug}, ${focusCompanyId}::uuid)
      ON CONFLICT (org_id, slug) DO NOTHING
      RETURNING id, name, slug
    ),
    desired_members (company_id, sort_order) AS (
      VALUES ${desiredMembers}
    ),
    added_members AS (
      INSERT INTO landscape_companies (landscape_id, company_id, sort_order)
      SELECT target_landscape.id, desired_members.company_id, desired_members.sort_order
      FROM target_landscape
      CROSS JOIN desired_members
      WHERE true
      ON CONFLICT (landscape_id, company_id) DO NOTHING
      RETURNING company_id
    )
    SELECT target_landscape.id,
           target_landscape.name,
           target_landscape.slug,
           (SELECT count(*)::integer FROM added_members) AS members_added
    FROM target_landscape
  `);
  const landscape = committed.rows[0];
  if (!landscape) {
    throw new HttpError(
      409,
      'A landscape with that name already exists. Choose a different name.',
      'duplicate_landscape',
    );
  }

  if (!hasRole(actor.role, 'admin')) {
    await db.insert(userLandscapeAccess).values({
      userId: actor.userId,
      landscapeId: landscape.id,
      grantedBy: actor.userId,
    });
  }

  const [membership] = await db
    .select({ count: sql<number>`count(*)::integer` })
    .from(landscapeCompanies)
    .where(eq(landscapeCompanies.landscapeId, landscape.id));

  const collectionUntil = new Date();
  const collectionSince = new Date(collectionUntil.getTime() - 90 * 86_400_000);
  const { enqueueLandscapeCollection } = await import('@/lib/adapters/collection-queue');
  const collection = await enqueueLandscapeCollection({
    orgId,
    landscapeId: landscape.id,
    since: collectionSince,
    until: collectionUntil,
  });

  const result: LandscapeImportResult = {
    landscape: {
      id: landscape.id,
      name: landscape.name,
      slug: landscape.slug,
      created: true,
      focusCompanyId,
    },
    counts: {
      companiesCreated,
      companiesReused: currentPlan.companies.length - companiesCreated,
      accountsAdded,
      accountsReused: currentPlan.accounts.length - accountsAdded,
      membersAdded: Number(landscape.members_added) || 0,
      membersTotal: membership?.count ?? 0,
      collectionQueued: collection.queued,
    },
    warnings: currentPlan.warnings.filter((warning) => warning.code !== 'focus_required'),
  };
  return Response.json(result, {
    status: 201,
    headers: { 'cache-control': 'private, no-store' },
  });
}

export const POST = apiHandler(async (req: NextRequest) => {
  const actor = await requireRole('editor');
  const body = await readJson(req, requestSchema);
  const parsed = parseLandscapeImportCsv(body.csv);
  const plan = await buildPlan(parsed, actor.orgId, body.landscapeName);

  if (body.action === 'preview') {
    return Response.json(plan, {
      headers: { 'cache-control': 'private, no-store' },
    });
  }
  return commitImport(body, actor, plan);
});
