import type { Metadata } from 'next';
import type { Platform } from '@/lib/types';
import { roleAtLeast } from '@/lib/roles';
import {
  CompaniesManager, type CompanyRecord, type LandscapeRecordFull,
} from '@/components/settings/companies-manager';
import { query, type SearchParamsInput } from '../../_lib/data';
import { resolveContext } from '../../_lib/context';

export const metadata: Metadata = { title: 'Companies and Social Profiles' };

type CompanyProfileRow = {
  id: string;
  platform: Platform;
  handle: string;
  profileUrl: string | null;
  active: boolean;
};

type CompanyRow = {
  id: string;
  name: string;
  website: string | null;
  segment: string | null;
  color: string | null;
  attributed_to_org: boolean;
  channel_count: number | string;
  channels: CompanyProfileRow[] | null;
  in_selected_landscape: boolean | null;
};

type LandscapeRow = {
  id: string;
  name: string;
  focus_company_id: string | null;
  focus_company_name: string | null;
  member_ids: string[] | null;
  member_count: number | string;
};

export default async function CompaniesSettingsPage({
  searchParams,
}: {
  searchParams: Promise<SearchParamsInput>;
}) {
  /*
   * The selected landscape decides what this page leads with.
   *
   * searchParams was awaited and thrown away, so the page rendered every
   * company the workspace could see no matter which landscape the switcher was
   * on. Switching landscapes changed nothing, which reads as a broken control
   * and makes the screen useless for the question people bring to it.
   */
  const ctx = await resolveContext(await searchParams);
  const { requireOrg } = await import('@/lib/session');
  const { orgId, role } = await requireOrg();
  const selectedLandscapeId = ctx.landscape?.id ?? null;

  const [companies, landscapes] = await Promise.all([
    query<CompanyRow>(({ sql }) => sql`
      SELECT c.id, c.name, c.website, c.segment, c.color,
             (c.org_id = ${orgId}::uuid) AS attributed_to_org,
             EXISTS (
               SELECT 1 FROM landscape_companies sel
                WHERE sel.company_id = c.id
                  AND sel.landscape_id = ${selectedLandscapeId}::uuid
             ) AS in_selected_landscape,
             count(ch.id) AS channel_count,
             coalesce(
               jsonb_agg(
                 jsonb_build_object(
                   'id', ch.id,
                   'platform', ch.platform,
                   'handle', ch.handle,
                   'profileUrl', ch.profile_url,
                   'active', ch.active
                 )
                 ORDER BY ch.platform ASC, ch.handle ASC
               ) FILTER (WHERE ch.id IS NOT NULL),
               '[]'::jsonb
             ) AS channels
        FROM companies c
        LEFT JOIN channels ch ON ch.company_id = c.id
       WHERE c.org_id = ${orgId}::uuid
          OR EXISTS (
               SELECT 1
                 FROM landscape_companies visible_lc
                 JOIN landscapes visible_l
                   ON visible_l.id = visible_lc.landscape_id
                WHERE visible_lc.company_id = c.id
                  AND visible_l.org_id = ${orgId}::uuid
             )
       GROUP BY c.id
       ORDER BY c.name ASC
    `),
    query<LandscapeRow>(({ sql }) => sql`
      SELECT l.id, l.name, l.focus_company_id,
             fc.name AS focus_company_name,
             coalesce(array_agg(lc.company_id) FILTER (WHERE lc.company_id IS NOT NULL), '{}') AS member_ids,
             count(lc.company_id) AS member_count
        FROM landscapes l
        LEFT JOIN companies fc ON fc.id = l.focus_company_id
        LEFT JOIN landscape_companies lc ON lc.landscape_id = l.id
       WHERE l.org_id = ${orgId}::uuid
       GROUP BY l.id, fc.name
       ORDER BY l.name ASC
    `),
  ]);

  const companyRecords: CompanyRecord[] = companies.data.map((c) => ({
    id: c.id,
    name: c.name,
    website: c.website,
    segment: c.segment,
    color: c.color,
    attributedToOrg: c.attributed_to_org === true,
    inSelectedLandscape: c.in_selected_landscape === true,
    channelCount: Number(c.channel_count) || 0,
    channels: Array.isArray(c.channels) ? c.channels : [],
  }));

  const landscapeRecords: LandscapeRecordFull[] = landscapes.data.map((l) => ({
    id: l.id,
    name: l.name,
    focusCompanyId: l.focus_company_id,
    focusCompanyName: l.focus_company_name,
    memberIds: Array.isArray(l.member_ids) ? l.member_ids : [],
    memberCount: Number(l.member_count) || 0,
  }));

  return (
    <div className="mx-auto max-w-5xl space-y-4">
      <div>
        <h2 className="text-base font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
          Companies and social profiles
        </h2>
        <p className="mt-1 max-w-3xl text-sm leading-relaxed text-zinc-600 dark:text-zinc-400">
          Add the brands you measure, connect their social profiles, then group them into landscapes.
          Share of voice and share of engagement are defined entirely by who is in each landscape.
        </p>
      </div>

      {companies.error || landscapes.error ? (
        <p className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700 dark:border-red-900/50 dark:bg-red-950/30 dark:text-red-400">
          {'Settings could not be read: ' + (companies.error ?? landscapes.error)}
        </p>
      ) : null}

      <CompaniesManager
        companies={companyRecords}
        landscapeName={ctx.landscape?.name ?? null}
        landscapes={landscapeRecords}
        canEdit={roleAtLeast(role, 'editor')}
        canDeleteCompanies={roleAtLeast(role, 'admin')}
      />
    </div>
  );
}
