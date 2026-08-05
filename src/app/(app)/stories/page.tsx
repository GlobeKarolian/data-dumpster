import type { Metadata } from 'next';
import { NoLandscape } from '@/components/common/no-landscape';
import { StoryCloud } from '@/components/stories/story-cloud';
import { toStoryDto, type StoryCloudDto } from '@/components/stories/types';
import type { Platform } from '@/lib/types';
import { ADAPTER_SUPPORTED_PLATFORMS } from '@/lib/adapters/supported-platforms';
import { formatDate } from '@/components/ui/format';
import { resolveContext } from '../_lib/context';
import { query, tryQuery, type SearchParamsInput } from '../_lib/data';

export const metadata: Metadata = { title: 'Story Cloud' };
export const dynamic = 'force-dynamic';

const PLATFORM_SET = new Set<string>(ADAPTER_SUPPORTED_PLATFORMS);

/** Loose merges more; tight keeps stories apart. Bounds match the slider. */
function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function readThreshold(raw: string | string[] | undefined): number {
  const parsed = Number(Array.isArray(raw) ? raw[0] : raw);
  if (!Number.isFinite(parsed)) return 0.3;
  return clamp(Math.round(parsed * 50) / 50, 0.22, 0.4);
}

function readMinSize(raw: string | string[] | undefined): number {
  const parsed = Number(Array.isArray(raw) ? raw[0] : raw);
  if (!Number.isFinite(parsed)) return 3;
  return clamp(Math.round(parsed), 2, 6);
}

/**
 * The Story Cloud screen.
 *
 * Clustering is CPU bound and already lives behind a function, so this calls it
 * directly rather than paying for an HTTP hop to the app's own API on every
 * render. The API route stays for scripts and integrations.
 */
export default async function StoriesPage({
  searchParams,
}: {
  searchParams: Promise<SearchParamsInput>;
}) {
  const resolved = await searchParams;
  const ctx = await resolveContext(resolved);
  if (!ctx.landscape) return <NoLandscape reason={ctx.error} />;

  const threshold = readThreshold(resolved.threshold);
  const minSize = readMinSize(resolved.minSize);
  const landscapeId = ctx.landscape.id;

  const [cloud, channelPlatforms] = await Promise.all([
    tryQuery<StoryCloudDto>(async () => {
      const { getStoryCloud } = await import('@/lib/stories/query');
      const result = await getStoryCloud({
        landscapeId,
        start: ctx.range.start,
        end: ctx.range.end,
        platforms: ctx.platforms.length > 0 ? ctx.platforms : undefined,
        companyIds: ctx.companyIds.length > 0 ? ctx.companyIds : undefined,
        options: { threshold, minSize },
      });
      return {
        clusters: result.clusters.map(toStoryDto),
        postCount: result.postCount,
        unclusteredCount: result.unclusteredCount,
      };
    }, { clusters: [], postCount: 0, unclusteredCount: 0 }),
    query<{ platform: string }>(({ sql }) => sql`
      SELECT DISTINCT ch.platform
        FROM channels ch
        JOIN landscape_companies lc ON lc.company_id = ch.company_id
       WHERE lc.landscape_id = ${landscapeId}::uuid
         AND ch.active = true
    `),
  ]);

  const availablePlatforms = channelPlatforms.data
    .map((r) => r.platform)
    .filter((p): p is Platform => PLATFORM_SET.has(p));

  return (
    <div className="space-y-4">
      <div className="max-w-3xl">
        <h2 className="text-base font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
          What the market covered together
        </h2>
        <p className="mt-1 text-sm leading-relaxed text-zinc-600 dark:text-zinc-400">
          Every post in this landscape between {formatDate(ctx.range.start)} and{' '}
          {formatDate(ctx.range.end)}, grouped into the real-world events behind them by shared links,
          shared rare terms and time proximity. Each bubble is one event. The ones with heavy outlines
          were covered by more than one newsroom. Data Dumpster names who arrived first and who won
          engagement only when the cluster clears its confidence threshold.
        </p>
      </div>

      <StoryCloud
        cloud={cloud.data}
        threshold={threshold}
        minSize={minSize}
        platforms={ctx.platforms}
        availablePlatforms={availablePlatforms}
        error={cloud.error}
      />
    </div>
  );
}
