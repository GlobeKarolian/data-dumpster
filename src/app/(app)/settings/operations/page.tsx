import type { Metadata } from 'next';
import { sql } from 'drizzle-orm';
import { db } from '@/db';
import { PageSection } from '@/components/shell/page-section';
import { Panel } from '@/components/common/panel';
import { roleAtLeast } from '@/lib/roles';
import { readAllControls } from '@/lib/controls';
import {
  OperationsPanel,
  type CompanyOption,
  type LandscapeOption,
  type OperationsStatus,
} from '@/components/settings/operations-panel';
import { resolveContext } from '../../_lib/context';
import { type SearchParamsInput } from '../../_lib/data';

export const metadata: Metadata = { title: 'Operations' };
export const dynamic = 'force-dynamic';

async function liveStatus(): Promise<OperationsStatus> {
  const [queue, spend, comments, summaries] = await Promise.all([
    db.execute<{ platform: string; pending: string | number; blocked: string | number }>(sql`
      SELECT c.platform,
             count(*) FILTER (
               WHERE s.status IN ('queued', 'running', 'partial')
                  OR (s.status = 'failed' AND s.next_attempt_at IS NOT NULL)
             ) AS pending,
             count(*) FILTER (
               WHERE s.status = 'failed' AND s.next_attempt_at IS NULL
             ) AS blocked
        FROM channel_collection_state s
        JOIN channels c ON c.id = s.channel_id
       GROUP BY 1 ORDER BY 2 DESC`),
    db.execute<{ vendor: string; records: string | number; cents: string | number }>(sql`
      SELECT vendor, sum(records) AS records, sum(estimated_cents) AS cents
        FROM vendor_spend
       WHERE created_at > date_trunc('day', now())
       GROUP BY 1`),
    db.execute<{ platform: string; comments: string | number }>(sql`
      SELECT c.platform, count(pc.id) AS comments
        FROM post_comments pc
        JOIN posts p ON p.id = pc.post_id
        JOIN channels c ON c.id = p.channel_id
       WHERE pc.collected_at > date_trunc('day', now())
       GROUP BY 1`),
    db.execute<{ written: string | number }>(sql`
      SELECT count(*) AS written
        FROM comment_summaries
       WHERE generated_at > date_trunc('day', now())`),
  ]);
  return {
    queueByPlatform: queue.rows.map((row) => ({
      platform: row.platform,
      pending: Number(row.pending) || 0,
      blocked: Number(row.blocked) || 0,
    })),
    spendToday: spend.rows.map((row) => ({
      vendor: row.vendor,
      records: Number(row.records) || 0,
      cents: Number(row.cents) || 0,
    })),
    commentsToday: comments.rows.map((row) => ({
      platform: row.platform,
      comments: Number(row.comments) || 0,
    })),
    summariesToday: Number(summaries.rows[0]?.written) || 0,
  };
}

export default async function OperationsPage({ searchParams }: {
  searchParams: Promise<SearchParamsInput>;
}) {
  const ctx = await resolveContext(await searchParams);
  if (!roleAtLeast(ctx.role, 'owner')) {
    return (
      <PageSection title="Operations">
        <Panel title="Owner only">
          <p className="p-4 text-sm text-zinc-600 dark:text-zinc-400">
            The operations panel moves real crawls and real money for every
            workspace, so it belongs to the workspace owner alone.
          </p>
        </Panel>
      </PageSection>
    );
  }

  const [controls, status, companyRows, landscapeRows] = await Promise.all([
    readAllControls(),
    liveStatus(),
    db.execute<{ id: string; name: string }>(sql`
      SELECT id::text AS id, name FROM companies ORDER BY name ASC LIMIT 500`),
    // Each landscape with what pausing it would actually stop: the channels
    // nothing else asks for, and the paid-platform volume it drives.
    db.execute<{
      id: string; name: string; members: string | number;
      channels: string | number; exclusive_channels: string | number;
      paid_posts_per_day: string | number;
    }>(sql`
      SELECT l.id::text AS id, l.name,
             count(DISTINCT lc.company_id) AS members,
             count(DISTINCT c.id) FILTER (WHERE c.active) AS channels,
             count(DISTINCT c.id) FILTER (
               WHERE c.active AND NOT EXISTS (
                 SELECT 1 FROM landscape_companies o
                  WHERE o.company_id = lc.company_id
                    AND o.landscape_id <> l.id)
             ) AS exclusive_channels,
             round(count(p.id) FILTER (
               WHERE c.platform IN ('facebook','instagram','tiktok',
                                    'threads','linkedin','twitter')
             ) / 30.0, 0) AS paid_posts_per_day
        FROM landscapes l
        LEFT JOIN landscape_companies lc ON lc.landscape_id = l.id
        LEFT JOIN channels c ON c.company_id = lc.company_id
        LEFT JOIN posts p ON p.channel_id = c.id
             AND p.posted_at > now() - interval '30 days'
       GROUP BY l.id, l.name ORDER BY l.name ASC`),
  ]);
  const companies: CompanyOption[] = companyRows.rows.map((row) => ({
    id: row.id,
    name: row.name,
  }));
  const landscapes: LandscapeOption[] = landscapeRows.rows.map((row) => ({
    id: row.id,
    name: row.name,
    members: Number(row.members) || 0,
    channels: Number(row.channels) || 0,
    exclusiveChannels: Number(row.exclusive_channels) || 0,
    paidPostsPerDay: Number(row.paid_posts_per_day) || 0,
  }));

  return (
    <PageSection
      title="Operations"
      description="Live dials for the collection machinery. Changes take effect on the next cron tick, no deploy needed."
    >
      <OperationsPanel
        controls={controls}
        status={status}
        companies={companies}
        landscapes={landscapes}
      />
    </PageSection>
  );
}
