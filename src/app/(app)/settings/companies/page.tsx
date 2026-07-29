import type { Metadata } from 'next';
import {
  CompaniesManager, type CompanyRecord, type LandscapeRecordFull,
} from '@/components/settings/companies-manager';
import { query, type SearchParamsInput } from '../../_lib/data';

export const metadata: Metadata = { title: 'Companies and Landscapes' };

type CompanyRow = {
  id: string;
  name: string;
  website: string | null;
  segment: string | null;
  color: string | null;
  channel_count: number | string;
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
  await searchParams;
  const { requireOrg } = await import('@/lib/session');
  const { orgId } = await requireOrg();

  const [companies, landscapes] = await Promise.all([
    query<CompanyRow>(({ sql }) => sql`
      SELECT c.id, c.name, c.website, c.segment, c.color,
             count(ch.id) AS channel_count
        FROM companies c
        LEFT JOIN channels ch ON ch.company_id = c.id
       WHERE c.org_id = ${orgId}::uuid
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
    channelCount: Number(c.channel_count) || 0,
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
          Companies and landscapes
        </h2>
        <p className="mt-1 max-w-3xl text-sm leading-relaxed text-zinc-600 dark:text-zinc-400">
          A company is something Data Dumpster measures. A landscape is a named set of them with one brand
          at the center. Getting the set right is the highest-leverage decision in the product:
          share-of-voice and share-of-engagement are defined entirely by who is in it.
        </p>
      </div>

      {companies.error || landscapes.error ? (
        <p className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700 dark:border-red-900/50 dark:bg-red-950/30 dark:text-red-400">
          {'Settings could not be read: ' + (companies.error ?? landscapes.error)}
        </p>
      ) : null}

      <CompaniesManager companies={companyRecords} landscapes={landscapeRecords} />
    </div>
  );
}
