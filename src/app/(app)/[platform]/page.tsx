import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { Radio } from 'lucide-react';
import { PLATFORM_LABELS, type Platform } from '@/lib/types';
import { NAV_PLATFORMS } from '@/components/shell/nav';
import { EmptyState } from '@/components/ui/empty-state';
import { effectiveFocusCompanyId } from '@/lib/analytics-scope';
import {
  classifyRedditHandles,
  type RedditEntityMix,
} from '@/lib/platform-language';
import { resolveContext } from '../_lib/context';
import { query, type SearchParamsInput } from '../_lib/data';
import { OverviewScreen } from '../_components/overview-screen';

/** Only the platforms with a nav entry get a screen; the rest 404 rather than render an empty shell. */
const SUPPORTED = new Set<string>(NAV_PLATFORMS);

type RedditSourceRow = {
  company_id: string;
  handle: string;
};

export async function generateMetadata({
  params,
}: {
  params: Promise<{ platform: string }>;
}): Promise<Metadata> {
  const { platform } = await params;
  if (!SUPPORTED.has(platform)) return { title: 'Not found' };
  return { title: PLATFORM_LABELS[platform as Platform] };
}

export default async function PlatformPage({
  params,
  searchParams,
}: {
  params: Promise<{ platform: string }>;
  searchParams: Promise<SearchParamsInput>;
}) {
  const { platform } = await params;
  if (!SUPPORTED.has(platform)) notFound();

  const ctx = await resolveContext(await searchParams);
  const typedPlatform = platform as Platform;
  let redditMode: RedditEntityMix | null = null;
  let redditTrackedCompanyIds: string[] = [];

  if (ctx.landscape) {
    const selectedCompanyIds = new Set(ctx.companyIds);
    const redditSources = typedPlatform === 'reddit'
      ? await query<RedditSourceRow>(({ sql }) => sql`
          SELECT ch.company_id, ch.handle
            FROM channels ch
            JOIN landscape_companies lc ON lc.company_id = ch.company_id
           WHERE lc.landscape_id = ${ctx.landscape!.id}::uuid
             AND ch.platform = 'reddit'::platform
             AND ch.active
        `)
      : null;
    const scopedRedditSources = redditSources?.data.filter(
      (source) => selectedCompanyIds.size === 0 || selectedCompanyIds.has(source.company_id),
    ) ?? [];
    const channelCount = redditSources
      ? {
          data: [{ count: scopedRedditSources.length }],
          error: redditSources.error,
        }
      : await query<{ count: number | string }>(({ sql }) => sql`
          SELECT count(*) AS count
            FROM channels ch
            JOIN landscape_companies lc ON lc.company_id = ch.company_id
           WHERE lc.landscape_id = ${ctx.landscape!.id}::uuid
             AND ch.platform = ${typedPlatform}::platform
             AND ch.active
        `);

    if (typedPlatform === 'reddit') {
      const focusCompanyId = effectiveFocusCompanyId(ctx.focusCompanyId, ctx.companyIds);
      const focusHandles = scopedRedditSources
        .filter((source) => source.company_id === focusCompanyId)
        .map((source) => source.handle);
      redditMode = classifyRedditHandles(focusHandles);
      redditTrackedCompanyIds = Array.from(new Set(
        scopedRedditSources.map((source) => source.company_id),
      ));
    }

    if (!channelCount.error && Number(channelCount.data[0]?.count ?? 0) === 0) {
      const label = PLATFORM_LABELS[typedPlatform];
      const redditDescription = (
        <>
          Add a Reddit user profile such as u/bostonglobe to a company in this landscape.
          Data Dumpster will collect that account&apos;s posts, scores, and comments. Public user
          follower totals, views, and saves stay blank because Reddit does not expose them.
          Existing r/name community sources remain supported separately.
        </>
      );

      return (
        <div className="mx-auto max-w-3xl">
          <EmptyState
            icon={Radio}
            title={'Connect ' + label + ' to this landscape'}
            description={
              typedPlatform === 'reddit'
                ? redditDescription
                : 'Add a ' + label + ' profile to at least one company before opening its analytics.'
            }
            action={{ label: 'Add social profile', href: '/settings/sources' }}
          />
        </div>
      );
    }
  }

  return (
    <OverviewScreen
      ctx={ctx}
      platform={typedPlatform}
      redditMode={redditMode}
      redditTrackedCompanyIds={redditTrackedCompanyIds}
    />
  );
}
