'use client';

import * as React from 'react';
import { ExternalLink, FileText, Loader2, Play, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { formatDateTime, formatRelative } from '@/components/ui/format';
import { PlatformIcon } from '@/components/ui/platform-icon';
import { PLATFORM_COLORS, PLATFORM_LABELS } from '@/lib/types';
import { postPosterUrl } from '@/lib/post-preview-url';
import { cn } from '@/lib/utils';
import {
  REPORT_PLATFORMS,
  REPORT_PLATFORM_LABELS,
  type ComputedBlock,
  type Movement,
  type ReportPlatform,
  type TopPost,
} from '@/lib/reports/types';
import { formatCount, formatPct, formatRate, formatSignedCount } from '@/lib/reports/render';
import { Figure, HeaderWithDefinition, SectionCard } from './ui';

const TH = 'px-3 py-2 text-left text-[11px] font-medium uppercase tracking-wider text-zinc-500 '
  + 'dark:text-zinc-400';
const THR = TH.replace('text-left', 'text-right');
const TD = 'px-3 py-2 text-sm text-zinc-800 dark:text-zinc-200';
const TDR = 'pb-num px-3 py-2 text-right text-sm text-zinc-800 dark:text-zinc-200';

function toneOf(movement: Movement): 'neutral' | 'up' | 'down' {
  if (movement.direction === 'up') return 'up';
  if (movement.direction === 'down') return 'down';
  return 'neutral';
}

function against(movement: Movement, previousLabel: string): string {
  if (movement.previousValue === null) return 'no comparable prior week';
  return formatPct(movement.changePct) + ' vs ' + formatCount(movement.previousValue)
    + ' ' + previousLabel;
}

/** The stamp that answers the only question anyone asks: is this current. */
export function RecomputeBar({
  computedAt,
  busy,
  disabled = false,
  onRecompute,
  error,
}: {
  computedAt: string | null;
  busy: boolean;
  disabled?: boolean;
  onRecompute: () => void;
  error: string | null;
}) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-2">
      <p className="max-w-2xl text-[11px] leading-relaxed text-zinc-500 dark:text-zinc-400">
        Recomputing replaces the numeric snapshot and clears narrative grounded
        in the previous figures.
      </p>
      <div className="flex flex-wrap items-center justify-end gap-2">
        <span className="pb-num text-[11px] text-zinc-500 dark:text-zinc-400">
          {computedAt
            ? 'Computed ' + formatRelative(computedAt) + ' (' + formatDateTime(computedAt) + ')'
            : 'Never computed'}
        </span>
        <Button
          size="sm"
          variant="secondary"
          onClick={onRecompute}
          disabled={busy || disabled}
        >
          {busy
            ? <Loader2 className="h-3 w-3 animate-spin" aria-hidden />
            : <RefreshCw className="h-3 w-3" aria-hidden />}
          {busy ? 'Recomputing' : 'Recompute'}
        </Button>
      </div>
      {error ? (
        <span className="w-full text-right text-[11px] text-red-600 dark:text-red-400">{error}</span>
      ) : null}
    </div>
  );
}

export function PerformanceSection({ computed }: { computed: ComputedBlock }) {
  const f = computed.focus;
  const brand = f.companyName ?? 'Focus brand not set';
  const platformCoverageNotes = computed.caveats.filter((caveat) => /^\d+ of \d+ tracked /.test(caveat));
  const interpretiveNotes = computed.caveats.filter((caveat) => !/^\d+ of \d+ tracked /.test(caveat));
  return (
    <SectionCard
      title="Performance"
      kind="computed"
      description={
        brand + ', ' + computed.period.start + ' to ' + computed.period.end
        + ', measured against ' + computed.previousPeriod.start + ' to ' + computed.previousPeriod.end + '.'
      }
    >
      <div className="grid grid-cols-2 gap-x-6 gap-y-5 p-4 md:grid-cols-4">
        <Figure
          label="Net followers"
          hint={
            'Followers on the last day of the window minus followers on the first day, summed '
            + 'across Facebook, Instagram, YouTube, X and TikTok. This is growth inside the week, '
            + 'not the total audience.'
          }
          value={formatSignedCount(f.netFollowers)}
          tone={
            f.netFollowers === null
              ? 'neutral'
              : f.netFollowers > 0 ? 'up' : f.netFollowers < 0 ? 'down' : 'neutral'
          }
          sub={f.previousNetFollowers === null
            ? 'no comparable prior week'
            : formatSignedCount(f.previousNetFollowers) + ' the week before'}
        />
        <Figure
          label="Total followers"
          metric="audience"
          value={formatCount(f.followers.value)}
          sub={against(f.followers, 'a week earlier')}
        />
        <Figure
          label="Engagement total"
          metric="engagementTotal"
          value={formatCount(f.engagementTotal.value)}
          tone={toneOf(f.engagementTotal)}
          sub={against(f.engagementTotal, 'the week before')}
        />
        <Figure
          label="Engagement per post"
          metric="engagementPerPost"
          value={formatRate(f.engagementPerPost.value)}
          tone={toneOf(f.engagementPerPost)}
          sub={formatCount(f.posts.value) + ' posts, '
            + (f.engagementPerPost.previousValue === null
              ? 'no prior rate'
              : formatPct(f.engagementPerPost.changePct) + ' week over week')}
        />
      </div>
      {computed.caveats.length > 0 ? (
        <div className="border-t border-zinc-200 px-4 py-3 dark:border-zinc-800">
          <p className="text-[11px] font-medium uppercase tracking-wider text-zinc-600 dark:text-zinc-300">
            Data coverage notes
          </p>
          <p className="mt-1 text-xs leading-relaxed text-zinc-500 dark:text-zinc-400">
            Platform coverage only evaluates brands with a tracked account on that platform.
            A brand without an account is not treated as missing data.
          </p>
          <ul className="mt-2 grid gap-x-6 gap-y-1.5 lg:grid-cols-2">
            {interpretiveNotes.map((caveat) => (
              <li
                key={caveat}
                className="relative pl-3 text-xs leading-relaxed text-zinc-600 before:absolute before:left-0 before:top-[0.55em] before:h-1 before:w-1 before:rounded-full before:bg-zinc-300 dark:text-zinc-400 dark:before:bg-zinc-700"
              >
                {caveat}
              </li>
            ))}
          </ul>
          {platformCoverageNotes.length > 0 ? (
            <details className="mt-3 rounded-md border border-zinc-200 bg-zinc-50/70 px-3 py-2 dark:border-zinc-800 dark:bg-zinc-950/40">
              <summary className="cursor-pointer text-xs font-medium text-zinc-600 marker:text-zinc-400 dark:text-zinc-300">
                {'Platform-by-platform collection detail (' + platformCoverageNotes.length + ')'}
              </summary>
              <ul className="mt-2 grid gap-x-6 gap-y-1.5 lg:grid-cols-2">
                {platformCoverageNotes.map((caveat) => (
                  <li
                    key={caveat}
                    className="relative pl-3 text-xs leading-relaxed text-zinc-500 before:absolute before:left-0 before:top-[0.55em] before:h-1 before:w-1 before:rounded-full before:bg-zinc-300 dark:text-zinc-400 dark:before:bg-zinc-700"
                  >
                    {caveat}
                  </li>
                ))}
              </ul>
            </details>
          ) : null}
        </div>
      ) : null}
    </SectionCard>
  );
}

export function BrandsSection({ computed }: { computed: ComputedBlock }) {
  return (
    <SectionCard
      title="Owned Brands Key Metrics"
      kind="computed"
      description="Every brand in the landscape, ranked by total followers. BGM-owned brands are highlighted in red."
    >
      <div className="overflow-x-auto">
        <table className="w-full border-collapse">
          <thead className="border-b border-zinc-200 dark:border-zinc-800">
            <tr>
              <th className={THR} scope="col">#</th>
              <th className={TH} scope="col">Brand</th>
              <th className={THR} scope="col">
                <HeaderWithDefinition label="Total followers" metric="audience" />
              </th>
              <th className={THR} scope="col">
                <HeaderWithDefinition
                  label="Net change"
                  hint="Followers on the last day of the window minus the first day, summed across every platform column shown here."
                />
              </th>
              {REPORT_PLATFORMS.map((p) => (
                <th key={p} className={THR} scope="col">{REPORT_PLATFORM_LABELS[p]}</th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800/60">
            {computed.brands.map((b) => (
              <tr
                key={b.companyId}
                className={b.isBgmOwned ? 'bg-accent-600/5 dark:bg-accent-600/10' : undefined}
              >
                <td className={cn(
                  'pb-num px-3 py-2 text-right text-xs text-zinc-400',
                  b.isBgmOwned && 'border-l-2 border-accent-600',
                )}>
                  {b.rank ?? '—'}
                </td>
                <td className={cn(
                  TD,
                  'font-medium whitespace-nowrap',
                  b.isBgmOwned && 'font-semibold text-accent-700 dark:text-accent-400',
                )}>
                  {b.name}
                  {b.isBgmOwned ? (
                    <span className="ml-2 rounded bg-accent-600/10 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wider text-accent-700 dark:text-accent-400">
                      BGM
                    </span>
                  ) : null}
                </td>
                <td className={TDR}>{formatCount(b.totalFollowers)}</td>
                <td
                  className={TDR + (b.netChange !== null && b.netChange > 0
                    ? ' text-emerald-700 dark:text-emerald-400'
                    : b.netChange !== null && b.netChange < 0
                      ? ' text-red-700 dark:text-red-400'
                      : '')}
                >
                  {formatSignedCount(b.netChange)}
                </td>
                {REPORT_PLATFORMS.map((p) => (
                  <td key={p} className={TDR + ' text-zinc-500 dark:text-zinc-400'}>
                    {b.byPlatform[p] === undefined ? '—' : formatCount(b.byPlatform[p])}
                  </td>
                ))}
              </tr>
            ))}
            {computed.brands.length === 0 ? (
              <tr>
                <td className={TD + ' text-zinc-500'} colSpan={4 + REPORT_PLATFORMS.length}>
                  No brands in this landscape have audience data for the window.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </SectionCard>
  );
}

export function TopPostsSection({
  computed,
  reportShareToken,
}: {
  computed: ComputedBlock;
  reportShareToken?: string;
}) {
  const bgmPosts = computed.bgmTopPosts
    ?? computed.topPosts.filter((post) => post.isBgmOwned);
  return (
    <div className="space-y-4">
      <TopPostGroup
        title="Top Engaged Posts — Market"
        description="The five most engaged posts from every brand in this landscape."
        posts={computed.topPosts}
        reportShareToken={reportShareToken}
      />
      <TopPostGroup
        title="Top Engaged Posts — BGM"
        description="The five most engaged posts from BGM-owned brands in the same window."
        posts={bgmPosts}
        reportShareToken={reportShareToken}
        empty={computed.bgmTopPosts === undefined
          ? 'Recompute this report to add the BGM-only ranking.'
          : 'No BGM posts were recorded in this window.'}
      />
    </div>
  );
}

function TopPostGroup({
  title,
  description,
  posts,
  reportShareToken,
  empty = 'No posts were recorded in this window.',
}: {
  title: string;
  description: string;
  posts: TopPost[];
  reportShareToken?: string;
  empty?: string;
}) {
  return (
    <SectionCard title={title} kind="computed" description={description}>
      <ol className="space-y-3 p-3">
        {posts.map((post) => (
          <ReportPostCard key={post.id} post={post} reportShareToken={reportShareToken} />
        ))}
        {posts.length === 0 ? (
          <li className="rounded-md border border-dashed border-zinc-200 px-4 py-8 text-center text-sm text-zinc-500 dark:border-zinc-800">
            {empty}
          </li>
        ) : null}
      </ol>
    </SectionCard>
  );
}

export function ReportPostCard({
  post,
  reportShareToken,
}: {
  post: TopPost;
  reportShareToken?: string;
}) {
  const [previewFailed, setPreviewFailed] = React.useState(false);
  const previewUrl = postPosterUrl(
    {
      id: post.id,
      platform: post.platform,
      type: post.type ?? 'text',
      permalink: post.permalink,
      thumbnailUrl: post.thumbnailUrl ?? null,
    },
    { reportShareToken },
  );
  const isMotion = ['video', 'reel', 'short', 'live'].includes(post.type ?? 'text');

  return (
    <li className={cn(
      'overflow-hidden rounded-lg border bg-white dark:bg-zinc-950/50',
      post.isBgmOwned
        ? 'border-accent-600/35 shadow-[inset_3px_0_0_#C8102E] dark:border-accent-600/40'
        : 'border-zinc-200 dark:border-zinc-800',
    )}>
      <article className="grid min-h-32 grid-cols-[8.5rem_1fr]">
        <div className="relative flex min-h-32 items-center justify-center overflow-hidden bg-zinc-100 text-zinc-400 dark:bg-zinc-900 dark:text-zinc-600">
          {previewUrl && !previewFailed ? (
            <>
              {/* Remote social previews intentionally bypass Next image optimization. */}
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={previewUrl}
                alt=""
                loading="lazy"
                className="absolute inset-0 h-full w-full object-cover"
                onError={() => setPreviewFailed(true)}
              />
              {isMotion ? (
                <span className="absolute inset-0 flex items-center justify-center bg-black/15">
                  <span className="flex h-8 w-8 items-center justify-center rounded-full bg-black/65 text-white">
                    <Play className="ml-0.5 h-3.5 w-3.5 fill-current" aria-hidden />
                  </span>
                </span>
              ) : null}
            </>
          ) : (
            <FileText className="h-6 w-6" aria-hidden />
          )}
          <span className="pb-num absolute left-2 top-2 rounded bg-black/70 px-1.5 py-0.5 text-[10px] font-semibold text-white">
            {'#' + post.rank}
          </span>
        </div>
        <div className="flex min-w-0 flex-col p-3">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <p className={cn(
                'truncate text-xs font-semibold text-zinc-900 dark:text-zinc-100',
                post.isBgmOwned && 'text-accent-700 dark:text-accent-400',
              )}>
                {post.companyName}
              </p>
              <p className="mt-1 flex items-center gap-1.5 text-[11px] text-zinc-500">
                <PlatformIcon platform={post.platform} className="h-3 w-3" />
                <span>{PLATFORM_LABELS[post.platform] ?? post.platform}</span>
                <span aria-hidden>·</span>
                <span className="pb-num">{formatDateTime(post.postedAt)}</span>
              </p>
            </div>
            <p className="pb-num shrink-0 text-sm font-semibold text-zinc-900 dark:text-zinc-50">
              {formatCount(post.engagementTotal)}
            </p>
          </div>
          <p className="mt-2 line-clamp-3 text-xs leading-relaxed text-zinc-600 dark:text-zinc-400">
            {post.text && post.text.trim() ? post.text : 'No post text was captured.'}
          </p>
          {post.permalink ? (
            <a
              href={post.permalink}
              target="_blank"
              rel="noreferrer"
              className="mt-auto inline-flex items-center gap-1 pt-2 text-[11px] font-medium text-zinc-500 transition-colors hover:text-accent-600"
            >
              Open original
              <ExternalLink className="h-2.5 w-2.5" aria-hidden />
            </a>
          ) : null}
        </div>
      </article>
    </li>
  );
}

/** Portfolio charts requested for the leadership-first report view. */
export function PortfolioCharts({ computed }: { computed: ComputedBlock }) {
  const brands = computed.brands.filter((brand) => brand.isBgmOwned);
  const largestFollowerSwing = Math.max(
    1,
    ...brands.map((brand) => Object.values(brand.netChangeByPlatform ?? {})
      .reduce((total, value) => total + Math.abs(value), 0)),
  );
  const largestRateSwing = Math.max(
    0.01,
    ...brands.map((brand) => Math.abs(brand.engagementRateChangePct ?? 0)),
  );

  return (
    <div className="space-y-4">
      <SectionCard
        title="Net Followers Added by BGM Brand"
        kind="computed"
        description="Each bar is the signed follower change during the week, split by platform. The center line is zero."
      >
        <div className="space-y-3 p-4">
          <div className="flex flex-wrap gap-x-3 gap-y-1 border-b border-zinc-100 pb-3 dark:border-zinc-800">
            {REPORT_PLATFORMS.map((platform) => (
              <span key={platform} className="inline-flex items-center gap-1.5 text-[10px] text-zinc-500">
                <span className="h-2 w-2 rounded-sm" style={{ backgroundColor: PLATFORM_COLORS[platform] }} />
                {REPORT_PLATFORM_LABELS[platform]}
              </span>
            ))}
          </div>
          {brands.map((brand) => {
            const entries = Object.entries(brand.netChangeByPlatform ?? {}) as Array<[ReportPlatform, number]>;
            const positive = entries.filter(([, value]) => value > 0);
            const negative = entries.filter(([, value]) => value < 0);
            const positiveWidth = positive.reduce((sum, [, value]) => sum + value, 0) / largestFollowerSwing * 100;
            const negativeWidth = Math.abs(negative.reduce((sum, [, value]) => sum + value, 0)) / largestFollowerSwing * 100;
            return (
              <div key={brand.companyId} className="grid grid-cols-[minmax(7rem,9rem)_1fr_4.5rem] items-center gap-3">
                <p className="truncate text-xs font-medium text-zinc-700 dark:text-zinc-300">{brand.name}</p>
                <div className="relative grid h-5 grid-cols-2">
                  <div className="flex justify-end overflow-hidden border-r border-zinc-300 dark:border-zinc-700">
                    <div className="flex h-3 self-center" style={{ width: negativeWidth + '%' }}>
                      {negative.map(([platform, value]) => (
                        <span
                          key={platform}
                          title={REPORT_PLATFORM_LABELS[platform] + ': ' + formatSignedCount(value)}
                          style={{
                            backgroundColor: PLATFORM_COLORS[platform],
                            width: Math.abs(value) / Math.max(1, Math.abs(negative.reduce((sum, [, part]) => sum + part, 0))) * 100 + '%',
                          }}
                        />
                      ))}
                    </div>
                  </div>
                  <div className="flex overflow-hidden">
                    <div className="flex h-3 self-center" style={{ width: positiveWidth + '%' }}>
                      {positive.map(([platform, value]) => (
                        <span
                          key={platform}
                          title={REPORT_PLATFORM_LABELS[platform] + ': ' + formatSignedCount(value)}
                          style={{
                            backgroundColor: PLATFORM_COLORS[platform],
                            width: value / Math.max(1, positive.reduce((sum, [, part]) => sum + part, 0)) * 100 + '%',
                          }}
                        />
                      ))}
                    </div>
                  </div>
                </div>
                <p className={cn(
                  'pb-num text-right text-xs font-semibold',
                  brand.netChange === null
                    ? 'text-zinc-400'
                    : brand.netChange > 0
                      ? 'text-emerald-700 dark:text-emerald-400'
                      : brand.netChange < 0
                        ? 'text-red-700 dark:text-red-400'
                        : 'text-zinc-500',
                )}>
                  {formatSignedCount(brand.netChange)}
                </p>
              </div>
            );
          })}
          {brands.length === 0 ? <EmptyChart /> : null}
        </div>
      </SectionCard>

      <SectionCard
        title="Engagement Rate Change by BGM Brand"
        kind="computed"
        description="Week-over-week change in engagement rate by follower. Left is down; right is up."
      >
        <div className="space-y-3 p-4">
          <div className="grid grid-cols-[minmax(7rem,9rem)_1fr_4.5rem] gap-3 border-b border-zinc-100 pb-2 text-[10px] uppercase tracking-wider text-zinc-400 dark:border-zinc-800">
            <span>Brand</span><span className="text-center">Down ← 0 → Up</span><span className="text-right">WoW</span>
          </div>
          {brands.map((brand) => {
            const change = brand.engagementRateChangePct;
            const width = change === null || change === undefined
              ? 0
              : Math.min(100, Math.abs(change) / largestRateSwing * 100);
            return (
              <div key={brand.companyId} className="grid grid-cols-[minmax(7rem,9rem)_1fr_4.5rem] items-center gap-3">
                <p className="truncate text-xs font-medium text-zinc-700 dark:text-zinc-300">{brand.name}</p>
                <div className="relative grid h-5 grid-cols-2">
                  <div className="flex justify-end border-r border-zinc-300 dark:border-zinc-700">
                    {change !== null && change !== undefined && change < 0 ? (
                      <span className="h-3 self-center bg-red-500/80" style={{ width: width + '%' }} />
                    ) : null}
                  </div>
                  <div className="flex">
                    {change !== null && change !== undefined && change >= 0 ? (
                      <span className="h-3 self-center bg-emerald-500/80" style={{ width: width + '%' }} />
                    ) : null}
                  </div>
                </div>
                <p className={cn(
                  'pb-num text-right text-xs font-semibold',
                  change === null || change === undefined
                    ? 'text-zinc-400'
                    : change > 0
                      ? 'text-emerald-700 dark:text-emerald-400'
                      : change < 0
                        ? 'text-red-700 dark:text-red-400'
                        : 'text-zinc-500',
                )}>
                  {change === null || change === undefined ? '—' : formatPct(change)}
                </p>
              </div>
            );
          })}
          {brands.length === 0 ? <EmptyChart /> : null}
        </div>
      </SectionCard>
    </div>
  );
}

function EmptyChart() {
  return <p className="py-5 text-center text-xs text-zinc-500">No BGM brand data was measured for this window.</p>;
}

export function BrandScorecards({ computed }: { computed: ComputedBlock }) {
  const brands = computed.brands.filter((brand) => brand.isBgmOwned);
  return (
    <SectionCard
      title="BGM Brand Scorecards"
      kind="computed"
      description="The same four measures for every owned brand, so leadership can scan the portfolio without reading a wide table."
    >
      <div className="divide-y divide-zinc-100 dark:divide-zinc-800">
        {brands.map((brand) => (
          <article key={brand.companyId} className="border-l-2 border-accent-600 px-4 py-4">
            <h4 className="text-base font-semibold tracking-tight text-zinc-900 dark:text-zinc-100">{brand.name}</h4>
            <div className="mt-3 grid grid-cols-2 gap-x-6 gap-y-4 md:grid-cols-4">
              <BrandMetric label="Audience" value={formatCount(brand.totalFollowers)} change={brand.changePct} />
              <BrandMetric label="Posts" value={formatCount(brand.posts)} change={brand.postsChangePct} />
              <BrandMetric label="Engagement total" value={formatCount(brand.engagementTotal)} change={brand.engagementChangePct} />
              <div>
                <p className="text-[10px] font-medium uppercase tracking-wider text-zinc-500">Most engaging channel</p>
                <p className="mt-2 flex items-center gap-2 text-base font-semibold text-zinc-900 dark:text-zinc-100">
                  {brand.topEngagementPlatform ? (
                    <><PlatformIcon platform={brand.topEngagementPlatform} className="h-5 w-5" />{REPORT_PLATFORM_LABELS[brand.topEngagementPlatform]}</>
                  ) : 'n/a'}
                </p>
              </div>
            </div>
          </article>
        ))}
        {brands.length === 0 ? <div className="p-6"><EmptyChart /></div> : null}
      </div>
    </SectionCard>
  );
}

function BrandMetric({ label, value, change }: { label: string; value: string; change?: number | null }) {
  return (
    <div>
      <p className="text-[10px] font-medium uppercase tracking-wider text-zinc-500">{label}</p>
      <p className="pb-num mt-1 text-xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">{value}</p>
      <p className={cn(
        'pb-num mt-0.5 text-xs font-medium',
        change === null || change === undefined
          ? 'text-zinc-400'
          : change > 0
            ? 'text-emerald-700 dark:text-emerald-400'
            : change < 0
              ? 'text-red-700 dark:text-red-400'
              : 'text-zinc-500',
      )}>
        {change === null || change === undefined ? 'No comparable prior week' : formatPct(change) + ' WoW'}
      </p>
    </div>
  );
}

export function CohortSection({ computed }: { computed: ComputedBlock }) {
  const cohort = computed.cohort;
  return (
    <SectionCard
      title="Boston News Landscape"
      kind="computed"
      description={
        cohort.memberCount + ' brands in ' + cohort.landscapeName
        + ', ranked by engagement for the week.'
      }
    >
      <div className="grid grid-cols-2 gap-x-6 gap-y-5 border-b border-zinc-200 p-4 md:grid-cols-3 dark:border-zinc-800">
        <Figure
          label="Cohort engagement"
          metric="engagementTotal"
          value={formatCount(cohort.engagement.value)}
          tone={toneOf(cohort.engagement)}
          sub={against(cohort.engagement, 'the week before')}
        />
        <Figure
          label="Our rank"
          hint="Position of the landscape focus brand when every brand is ordered by total engagement for the window."
          value={cohort.focusRank ? cohort.focusRank + ' of ' + cohort.memberCount : '—'}
          sub={cohort.focusCompanyName ?? 'No focus brand is set on this landscape'}
        />
        <Figure
          label="Best post rank"
          hint="Where the focus brand's strongest post placed among the most engaged posts in the whole landscape this week."
          value={cohort.focusPostRank
            ? cohort.focusPostRank + ' of ' + cohort.focusPostPool
            : 'Outside top ' + cohort.focusPostPool}
          sub="Across every brand in the landscape"
        />
      </div>
      <div className="overflow-x-auto">
        <table className="w-full border-collapse">
          <thead className="border-b border-zinc-200 dark:border-zinc-800">
            <tr>
              <th className={THR} scope="col">#</th>
              <th className={TH} scope="col">Brand</th>
              <th className={THR} scope="col">
                <HeaderWithDefinition label="Engagement" metric="engagementTotal" />
              </th>
              <th className={THR} scope="col">
                <HeaderWithDefinition
                  label="Week over week"
                  hint="Change against the same brand in the previous seven-day window. Blank where the prior week was zero."
                />
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800/60">
            {cohort.rows.map((r) => (
              <tr
                key={r.companyId}
                className={r.isBgmOwned ? 'bg-accent-600/5 dark:bg-accent-600/10' : undefined}
              >
                <td className={cn(
                  'pb-num px-3 py-2 text-right text-xs text-zinc-400',
                  r.isBgmOwned && 'border-l-2 border-accent-600',
                )}>
                  {r.rank}
                </td>
                <td className={TD + (r.isBgmOwned ? ' font-semibold text-accent-700 dark:text-accent-400' : '')}>
                  {r.name}
                  {r.isBgmOwned ? (
                    <span className="ml-2 rounded bg-accent-600/10 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wider text-accent-700 dark:text-accent-400">
                      BGM
                    </span>
                  ) : null}
                </td>
                <td className={TDR}>{formatCount(r.engagementTotal)}</td>
                <td
                  className={TDR + (r.changePct === null
                    ? ' text-zinc-400'
                    : r.changePct > 0
                      ? ' text-emerald-700 dark:text-emerald-400'
                      : r.changePct < 0 ? ' text-red-700 dark:text-red-400' : '')}
                >
                  {r.changePct === null ? '—' : formatPct(r.changePct)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </SectionCard>
  );
}
