import type { Metadata } from 'next';
import type { Platform } from '@/lib/types';
import { SourcesManager, type CompanySources } from '@/components/settings/sources-manager';
import { query, type SearchParamsInput } from '../../_lib/data';

export const metadata: Metadata = { title: 'Sources' };

type SourceRow = {
  company_id: string;
  company_name: string;
  channel_id: string | null;
  platform: Platform | null;
  handle: string | null;
  profile_url: string | null;
  active: boolean | null;
  is_owned: boolean | null;
  last_ingested_at: string | null;
  last_run_status: string | null;
  last_run_error: string | null;
  post_count: number | string | null;
};

export default async function SourcesPage({
  searchParams,
}: {
  searchParams: Promise<SearchParamsInput>;
}) {
  await searchParams;
  const { requireOrg } = await import('@/lib/session');
  const { orgId } = await requireOrg();

  const rows = await query<SourceRow>(({ sql }) => sql`
    SELECT c.id   AS company_id,
           c.name AS company_name,
           ch.id  AS channel_id,
           ch.platform,
           ch.handle,
           ch.profile_url,
           ch.active,
           ch.is_owned,
           ch.last_ingested_at,
           run.status AS last_run_status,
           run.error  AS last_run_error,
           (SELECT count(*) FROM posts p WHERE p.channel_id = ch.id) AS post_count
      FROM companies c
      LEFT JOIN channels ch ON ch.company_id = c.id
      LEFT JOIN LATERAL (
        SELECT r.status, r.error
          FROM ingestion_runs r
         WHERE r.channel_id = ch.id
         ORDER BY r.started_at DESC
         LIMIT 1
      ) run ON true
     WHERE c.org_id = ${orgId}::uuid
     ORDER BY c.name ASC, ch.platform ASC
  `);

  const byCompany = new Map<string, CompanySources>();
  for (const row of rows.data) {
    const entry = byCompany.get(row.company_id) ?? {
      id: row.company_id,
      name: row.company_name,
      channels: [],
    };
    if (row.channel_id && row.platform && row.handle) {
      entry.channels.push({
        id: row.channel_id,
        platform: row.platform,
        handle: row.handle,
        profileUrl: row.profile_url,
        active: row.active ?? true,
        isOwned: row.is_owned ?? false,
        lastIngestedAt: row.last_ingested_at,
        lastRunStatus: row.last_run_status,
        lastRunError: row.last_run_error,
        postCount: Number(row.post_count) || 0,
      });
    }
    byCompany.set(row.company_id, entry);
  }

  return (
    <div className="mx-auto max-w-5xl space-y-4">
      <div>
        <h2 className="text-base font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
          Sources
        </h2>
        <p className="mt-1 max-w-3xl text-sm leading-relaxed text-zinc-600 dark:text-zinc-400">
          A channel is one company’s presence on one platform. The dot beside each row is the honest
          freshness signal: every comparison elsewhere in Pressbox is only as current as the feed
          behind it, and a silently stale channel drags an average down without ever looking wrong.
        </p>
      </div>

      {rows.error ? (
        <p className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700 dark:border-red-900/50 dark:bg-red-950/30 dark:text-red-400">
          {'Channels could not be read: ' + rows.error}
        </p>
      ) : null}

      <SourcesManager companies={[...byCompany.values()]} />
    </div>
  );
}
