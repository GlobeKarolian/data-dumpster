'use client';

import * as React from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  ArrowDownRight,
  ArrowLeft,
  ArrowRight,
  ArrowUpRight,
  Clock3,
  ExternalLink,
  Maximize2,
  Minimize2,
  Pause,
  Play,
  RefreshCw,
} from 'lucide-react';
import type { PostDto, SummaryResult } from '@/lib/metrics/contract';
import type { MetricKey, MetricRow, Platform } from '@/lib/types';
import { PLATFORM_COLORS, PLATFORM_LABELS } from '@/lib/types';
import { postPosterUrl } from '@/lib/post-preview-url';
import { formatDateTime, formatMetric, truncate } from '@/components/ui/format';
import { PlatformIcon } from '@/components/ui/platform-icon';
import { DumpsterMark } from '@/components/shell/logo';
import { cn, formatChange } from '@/lib/utils';
import {
  NEWSROOM_REFRESH_MS,
  NEWSROOM_ROTATION_MS,
  newsroomFreshness,
  newsroomLeaderboardRows,
  newsroomPlatformWinners,
} from '@/lib/newsroom-display';

const SLIDES = [
  { id: 'leaders', label: '24-hour leaders' },
  { id: 'platforms', label: 'Top content by platform' },
  { id: 'pulse', label: 'Newsroom pulse' },
  { id: 'channels', label: 'Channel mix' },
] as const;

const CLOCK_FORMAT = new Intl.DateTimeFormat('en-US', {
  hour: 'numeric',
  minute: '2-digit',
  weekday: 'short',
  month: 'short',
  day: 'numeric',
  timeZone: 'America/New_York',
});

type DisplayFreshness = {
  lastIngestedAt: string | null;
  profileCount: number;
  freshProfileCount: number;
};

export interface NewsroomDisplayProps {
  landscape: {
    id: string;
    name: string;
    companyCount: number;
  };
  focusCompanyId: string | null;
  focusName: string;
  scopeLabel: string;
  rangeLabel: string;
  platformLabel: string;
  summary: SummaryResult | null;
  engagementRows: MetricRow[];
  recentEngagementRows: MetricRow[];
  topPosts: PostDto[];
  platforms: readonly Platform[];
  freshness: DisplayFreshness;
  generatedAt: string;
  errors: string[];
  exitHref: string;
}

function DisplayDelta({ changePct }: { changePct: number | null | undefined }) {
  const change = formatChange(changePct);
  const Icon = change.tone === 'up'
    ? ArrowUpRight
    : change.tone === 'down'
      ? ArrowDownRight
      : null;
  return (
    <span className={cn(
      'pb-num inline-flex items-center gap-1 text-[clamp(0.75rem,1vw,1.3rem)] font-semibold',
      change.tone === 'up' && 'text-emerald-400',
      change.tone === 'down' && 'text-rose-400',
      (change.tone === 'flat' || change.tone === 'na') && 'text-zinc-500',
    )}>
      {Icon ? <Icon className="h-[1em] w-[1em]" aria-hidden /> : null}
      {change.label}
      <span className="font-normal text-zinc-600">vs prior</span>
    </span>
  );
}

function MetricTile({
  label,
  metric,
  value,
  available,
  complete,
  changePct,
}: {
  label: string;
  metric: MetricKey;
  value: number;
  available: boolean;
  complete?: boolean;
  changePct?: number | null;
}) {
  return (
    <div className="flex min-h-0 flex-col justify-between rounded-[1.25vw] border border-white/10 bg-white/[0.045] p-[clamp(1rem,1.7vw,2rem)]">
      <p className="text-[clamp(0.7rem,0.82vw,1.05rem)] font-bold uppercase tracking-[0.16em] text-zinc-500">
        {label}
      </p>
      <p className="pb-num mt-2 text-[clamp(2.5rem,5.5vw,7rem)] font-semibold leading-none tracking-[-0.06em] text-white">
        {formatMetric(available ? value : null, metric)}
      </p>
      <div className="mt-3 flex min-h-6 items-center justify-between gap-3">
        <DisplayDelta changePct={available && complete !== false ? changePct : null} />
        {available && complete === false ? (
          <span className="rounded-full bg-amber-400/10 px-2.5 py-1 text-[clamp(0.65rem,0.72vw,0.9rem)] font-semibold text-amber-300">
            Partial coverage
          </span>
        ) : null}
      </div>
    </div>
  );
}

function PulseSlide({
  summary,
  rows,
  focusCompanyId,
  focusName,
}: {
  summary: SummaryResult | null;
  rows: MetricRow[];
  focusCompanyId: string | null;
  focusName: string;
}) {
  const headline = summary?.headline;
  const leaders = newsroomLeaderboardRows(rows, focusCompanyId, 5);
  const topPlatform = summary?.topPlatform ?? null;
  return (
    <div className="grid h-full min-h-0 grid-cols-[minmax(0,1.45fr)_minmax(18rem,0.75fr)] gap-[1.2vw]">
      <section className="grid min-h-0 grid-cols-2 grid-rows-2 gap-[1.2vw]" aria-label={`${focusName} headline metrics`}>
        <MetricTile
          label="Audience"
          metric="audience"
          value={headline?.audience.value ?? 0}
          available={headline?.audience.available === true}
          complete={headline?.audience.complete}
          changePct={headline?.audience.changePct}
        />
        <MetricTile
          label="Posts"
          metric="posts"
          value={headline?.posts.value ?? 0}
          available={headline?.posts.available === true}
          complete={headline?.posts.complete}
          changePct={headline?.posts.changePct}
        />
        <MetricTile
          label="Total engagement"
          metric="engagementTotal"
          value={headline?.engagementTotal.value ?? 0}
          available={headline?.engagementTotal.available === true}
          complete={headline?.engagementTotal.complete}
          changePct={headline?.engagementTotal.changePct}
        />
        <div className="flex min-h-0 flex-col justify-between rounded-[1.25vw] border border-white/10 bg-white/[0.045] p-[clamp(1rem,1.7vw,2rem)]">
          <p className="text-[clamp(0.7rem,0.82vw,1.05rem)] font-bold uppercase tracking-[0.16em] text-zinc-500">
            Most engaging channel
          </p>
          <div className="flex min-w-0 items-center gap-[1vw]">
            {topPlatform ? <PlatformIcon platform={topPlatform} className="h-[clamp(2.5rem,4.7vw,6rem)] w-[clamp(2.5rem,4.7vw,6rem)] text-white" /> : null}
            <p className="truncate text-[clamp(2rem,4.2vw,5.5rem)] font-semibold leading-none tracking-[-0.055em] text-white">
              {topPlatform ? PLATFORM_LABELS[topPlatform] : '—'}
            </p>
          </div>
          <p className="text-[clamp(0.75rem,0.9vw,1.1rem)] text-zinc-500">
            Highest measured engagement in this window
          </p>
        </div>
      </section>

      <section className="min-h-0 rounded-[1.25vw] border border-white/10 bg-white/[0.045] p-[clamp(1rem,1.5vw,1.8rem)]">
        <div className="flex items-end justify-between gap-4">
          <div>
            <p className="text-[clamp(0.65rem,0.72vw,0.9rem)] font-bold uppercase tracking-[0.16em] text-accent-400">
              Market watch
            </p>
            <h2 className="mt-1 text-[clamp(1.4rem,2.1vw,2.7rem)] font-semibold tracking-[-0.04em] text-white">
              Engagement leaders
            </h2>
          </div>
          <span className="text-[clamp(0.65rem,0.72vw,0.9rem)] text-zinc-600">Top 5</span>
        </div>
        <ol className="mt-[1.2vw] flex min-h-0 flex-col gap-[0.7vw]">
          {leaders.map((row) => {
            const focus = row.company.id === focusCompanyId;
            return (
              <li
                key={row.company.id}
                className={cn(
                  'grid grid-cols-[2.3rem_minmax(0,1fr)_auto] items-center gap-[0.7vw] rounded-[0.7vw] border px-[0.8vw] py-[0.7vw]',
                  focus
                    ? 'border-accent-500/60 bg-accent-600/15'
                    : 'border-white/5 bg-black/15',
                )}
              >
                <span className="pb-num text-[clamp(0.8rem,1vw,1.25rem)] font-semibold text-zinc-500">#{row.rank}</span>
                <span className={cn(
                  'truncate text-[clamp(0.8rem,1.05vw,1.35rem)] font-semibold',
                  focus ? 'text-white' : 'text-zinc-300',
                )}>{row.company.name}</span>
                <span className="pb-num text-[clamp(0.8rem,1.05vw,1.35rem)] font-semibold text-white">
                  {formatMetric(row.value, 'engagementTotal')}
                </span>
              </li>
            );
          })}
          {leaders.length === 0 ? (
            <li className="grid min-h-32 place-items-center text-[clamp(0.85rem,1vw,1.2rem)] text-zinc-600">
              No measured engagement yet.
            </li>
          ) : null}
        </ol>
      </section>
    </div>
  );
}

function PlatformWinnerCard({
  platform,
  post,
  focusCompanyId,
}: {
  platform: Platform;
  post: PostDto | null;
  focusCompanyId: string | null;
}) {
  const poster = post ? postPosterUrl(post) : null;
  const focus = post?.company.id === focusCompanyId;
  return (
    <article className={cn(
      'grid min-h-0 grid-cols-[42%_minmax(0,1fr)] overflow-hidden rounded-[0.9vw] border bg-white/[0.04]',
      focus ? 'border-accent-500/70' : 'border-white/10',
    )}>
      <div className="relative min-h-0 overflow-hidden bg-black">
        {poster ? (
          <>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={poster} alt="" aria-hidden className="absolute inset-0 h-full w-full scale-110 object-cover opacity-30 blur-xl" />
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={poster} alt="" className="relative z-10 h-full w-full object-contain" />
          </>
        ) : (
          <div className="grid h-full place-items-center bg-white/[0.025]">
            <PlatformIcon platform={platform} className="h-[clamp(2rem,3vw,3.8rem)] w-[clamp(2rem,3vw,3.8rem)] opacity-45" />
          </div>
        )}
        <span className="absolute left-[0.6vw] top-[0.6vw] z-20 inline-flex items-center gap-1.5 rounded-full bg-black/80 px-[0.55vw] py-[0.3vw] text-[clamp(0.58rem,0.7vw,0.86rem)] font-semibold text-white backdrop-blur">
          <PlatformIcon platform={platform} className="h-[1em] w-[1em] text-white" />
          {PLATFORM_LABELS[platform]}
        </span>
      </div>
      <div className="flex min-w-0 flex-col p-[clamp(0.65rem,0.85vw,1.05rem)]">
        {post ? (
          <>
            <div className="flex items-center gap-2">
              <p className="min-w-0 flex-1 truncate text-[clamp(0.72rem,0.9vw,1.12rem)] font-bold text-white">{post.company.name}</p>
              {post.permalink ? (
                <a href={post.permalink} target="_blank" rel="noopener noreferrer" aria-label={`Open ${post.company.name} ${PLATFORM_LABELS[platform]} post`} className="shrink-0 text-zinc-600 hover:text-white">
                  <ExternalLink className="h-[1em] w-[1em]" aria-hidden />
                </a>
              ) : null}
            </div>
            <p className="pb-num mt-0.5 text-[clamp(0.58rem,0.67vw,0.82rem)] text-zinc-600">{formatDateTime(post.postedAt)}</p>
            <p className="mt-[0.45vw] line-clamp-3 text-[clamp(0.64rem,0.76vw,0.95rem)] leading-[1.35] text-zinc-400">
              {post.text ? truncate(post.text, 130) : 'No caption'}
            </p>
            <p className="pb-num mt-auto border-t border-white/10 pt-[0.45vw] text-[clamp(0.9rem,1.25vw,1.55rem)] font-semibold text-white">
              {formatMetric(post.engagementTotal, 'engagementTotal')}
              <span className="ml-1 text-[0.52em] font-medium uppercase tracking-wide text-zinc-600">engagement</span>
            </p>
          </>
        ) : (
          <div className="grid h-full place-items-center text-center">
            <div>
              <p className="text-[clamp(0.72rem,0.9vw,1.1rem)] font-semibold text-zinc-400">No post today</p>
              <p className="mt-1 text-[clamp(0.58rem,0.66vw,0.8rem)] text-zinc-700">Nothing measured on {PLATFORM_LABELS[platform]}</p>
            </div>
          </div>
        )}
      </div>
    </article>
  );
}

function PlatformWinnersSlide({
  posts,
  platforms,
  focusCompanyId,
}: {
  posts: PostDto[];
  platforms: readonly Platform[];
  focusCompanyId: string | null;
}) {
  const winners = newsroomPlatformWinners(posts, platforms);
  const gridClass = winners.length <= 2
    ? 'grid-cols-2'
    : winners.length <= 4
      ? 'grid-cols-2'
      : 'grid-cols-3';
  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="mb-[0.8vw] flex items-end justify-between gap-4">
        <div>
          <p className="text-[clamp(0.65rem,0.75vw,0.95rem)] font-bold uppercase tracking-[0.18em] text-accent-400">Platform winners</p>
          <h2 className="mt-1 text-[clamp(1.7rem,2.7vw,3.5rem)] font-semibold leading-none tracking-[-0.045em] text-white">Today&apos;s top content by platform</h2>
        </div>
        <p className="max-w-[36vw] text-right text-[clamp(0.72rem,0.9vw,1.12rem)] leading-relaxed text-zinc-500">
          The highest-engagement post measured on every channel today.
        </p>
      </div>
      <div className={cn('grid min-h-0 flex-1 auto-rows-fr gap-[0.75vw]', gridClass)}>
        {winners.map(({ platform, post }) => (
          <PlatformWinnerCard key={platform} platform={platform} post={post} focusCompanyId={focusCompanyId} />
        ))}
      </div>
    </div>
  );
}

function LeaderboardSlide({ rows, focusCompanyId, focusName }: { rows: MetricRow[]; focusCompanyId: string | null; focusName: string }) {
  const visible = newsroomLeaderboardRows(rows, focusCompanyId, 8);
  const max = Math.max(1, ...visible.map((row) => row.value));
  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="mb-[0.9vw] flex items-end justify-between gap-4">
        <div>
          <p className="text-[clamp(0.65rem,0.75vw,0.95rem)] font-bold uppercase tracking-[0.18em] text-accent-400">Rolling 24 hours</p>
          <h2 className="mt-1 text-[clamp(1.7rem,2.7vw,3.5rem)] font-semibold leading-none tracking-[-0.045em] text-white">Who is generating the most engagement</h2>
        </div>
        <p className="text-[clamp(0.72rem,0.9vw,1.12rem)] text-zinc-500">Ranked by total engagement in the last 24 hours · {focusName} stays visible</p>
      </div>
      <ol className="flex min-h-0 flex-1 flex-col justify-between gap-[0.45vw]">
        {visible.map((row) => {
          const focus = row.company.id === focusCompanyId;
          const width = Math.max(2.5, (row.value / max) * 100);
          return (
            <li key={row.company.id} className={cn(
              'grid min-h-0 flex-1 grid-cols-[4.5vw_minmax(10rem,18vw)_minmax(0,1fr)_8vw] items-center gap-[1vw] rounded-[0.75vw] border px-[1vw]',
              focus ? 'border-accent-500/70 bg-accent-600/10' : 'border-white/5 bg-white/[0.025]',
            )}>
              <span className={cn('pb-num text-[clamp(1rem,1.55vw,2rem)] font-bold', focus ? 'text-accent-400' : 'text-zinc-600')}>#{row.rank}</span>
              <span className={cn('truncate text-[clamp(0.95rem,1.4vw,1.8rem)] font-semibold', focus ? 'text-white' : 'text-zinc-300')}>{row.company.name}</span>
              <span className="relative h-[clamp(0.7rem,1.15vw,1.45rem)] overflow-hidden rounded-full bg-white/[0.06]">
                <span
                  className={cn('absolute inset-y-0 left-0 rounded-full', focus ? 'bg-accent-500' : 'bg-zinc-400')}
                  style={{ width: `${width}%` }}
                />
              </span>
              <span className="pb-num text-right text-[clamp(1rem,1.4vw,1.8rem)] font-semibold text-white">{formatMetric(row.value, 'engagementTotal')}</span>
            </li>
          );
        })}
        {visible.length === 0 ? (
          <li className="grid flex-1 place-items-center rounded-[1.25vw] border border-dashed border-white/10 text-[clamp(1rem,1.3vw,1.7rem)] text-zinc-600">No measured leaderboard yet.</li>
        ) : null}
      </ol>
    </div>
  );
}

function ChannelSlide({ summary, focusName }: { summary: SummaryResult | null; focusName: string }) {
  const mix = [...(summary?.platformMix ?? [])]
    .filter((row) => Number.isFinite(row.focusValue) && row.focusValue > 0)
    .sort((a, b) => b.focusValue - a.focusValue)
    .slice(0, 8);
  const total = mix.reduce((sum, row) => sum + row.focusValue, 0);
  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="mb-[1vw] flex items-end justify-between gap-4">
        <div>
          <p className="text-[clamp(0.65rem,0.75vw,0.95rem)] font-bold uppercase tracking-[0.18em] text-accent-400">Channel intelligence</p>
          <h2 className="mt-1 text-[clamp(1.7rem,2.7vw,3.5rem)] font-semibold leading-none tracking-[-0.045em] text-white">Where {focusName} is connecting</h2>
        </div>
        <p className="max-w-[35vw] text-right text-[clamp(0.72rem,0.9vw,1.12rem)] text-zinc-500">Focus-brand engagement by platform, compared with the competitive average.</p>
      </div>
      <div className="grid min-h-0 flex-1 grid-cols-4 grid-rows-2 gap-[1vw]">
        {mix.map((row) => {
          const share = total > 0 ? row.focusValue / total : 0;
          return (
            <article key={row.platform} className="flex min-h-0 flex-col justify-between overflow-hidden rounded-[1.1vw] border border-white/10 bg-white/[0.04] p-[clamp(0.9rem,1.35vw,1.7rem)]">
              <div className="flex items-center justify-between gap-3">
                <span className="inline-flex min-w-0 items-center gap-[0.65vw]">
                  <PlatformIcon platform={row.platform} className="h-[clamp(1.25rem,1.7vw,2.2rem)] w-[clamp(1.25rem,1.7vw,2.2rem)] text-white" />
                  <span className="truncate text-[clamp(0.8rem,1.08vw,1.4rem)] font-semibold text-white">{PLATFORM_LABELS[row.platform]}</span>
                </span>
                <span className="pb-num text-[clamp(0.72rem,0.9vw,1.1rem)] font-semibold text-zinc-400">{Math.round(share * 100)}%</span>
              </div>
              <p className="pb-num text-[clamp(2rem,3.7vw,4.8rem)] font-semibold leading-none tracking-[-0.055em] text-white">{formatMetric(row.focusValue, 'engagementTotal')}</p>
              <div>
                <div className="mb-[0.65vw] h-[0.45vw] min-h-1 overflow-hidden rounded-full bg-white/10">
                  <div className="h-full rounded-full" style={{ width: `${Math.max(2, share * 100)}%`, backgroundColor: PLATFORM_COLORS[row.platform] }} />
                </div>
                <p className="pb-num text-[clamp(0.65rem,0.78vw,0.98rem)] text-zinc-600">
                  Market average {row.competitorAverage === null ? '—' : formatMetric(row.competitorAverage, 'engagementTotal')}
                </p>
              </div>
            </article>
          );
        })}
        {mix.length === 0 ? (
          <div className="col-span-4 row-span-2 grid place-items-center rounded-[1.25vw] border border-dashed border-white/10 text-[clamp(1rem,1.3vw,1.7rem)] text-zinc-600">No channel mix is available yet.</div>
        ) : null}
      </div>
    </div>
  );
}

function freshnessToneClass(tone: ReturnType<typeof newsroomFreshness>['tone']): string {
  if (tone === 'fresh') return 'bg-emerald-400';
  if (tone === 'aging') return 'bg-amber-400';
  if (tone === 'stale') return 'bg-rose-500';
  return 'bg-zinc-600';
}

export function NewsroomDisplay(props: NewsroomDisplayProps) {
  const router = useRouter();
  const [slide, setSlide] = React.useState(0);
  const [paused, setPaused] = React.useState(false);
  const [progress, setProgress] = React.useState(0);
  const [now, setNow] = React.useState(() => new Date(props.generatedAt));
  const [fullscreen, setFullscreen] = React.useState(false);

  const goTo = React.useCallback((next: number) => {
    setSlide((next + SLIDES.length) % SLIDES.length);
    setProgress(0);
  }, []);

  React.useEffect(() => {
    const clock = window.setInterval(() => setNow(new Date()), 30_000);
    const refresh = window.setInterval(() => router.refresh(), NEWSROOM_REFRESH_MS);
    return () => {
      window.clearInterval(clock);
      window.clearInterval(refresh);
    };
  }, [router]);

  React.useEffect(() => {
    if (paused) return;
    const step = 250 / NEWSROOM_ROTATION_MS;
    const timer = window.setInterval(() => {
      setProgress((current) => {
        const next = current + step;
        if (next >= 1) {
          setSlide((currentSlide) => (currentSlide + 1) % SLIDES.length);
          return 0;
        }
        return next;
      });
    }, 250);
    return () => window.clearInterval(timer);
  }, [paused]);

  React.useEffect(() => {
    const onFullscreen = () => setFullscreen(Boolean(document.fullscreenElement));
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === ' ') {
        event.preventDefault();
        setPaused((value) => !value);
      } else if (event.key === 'ArrowRight') {
        goTo(slide + 1);
      } else if (event.key === 'ArrowLeft') {
        goTo(slide - 1);
      }
    };
    document.addEventListener('fullscreenchange', onFullscreen);
    window.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('fullscreenchange', onFullscreen);
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [goTo, slide]);

  const toggleFullscreen = async () => {
    if (document.fullscreenElement) await document.exitFullscreen();
    else await document.documentElement.requestFullscreen();
  };
  const freshness = newsroomFreshness(props.freshness.lastIngestedAt, now.getTime());
  const freshRatio = props.freshness.profileCount > 0
    ? `${props.freshness.freshProfileCount}/${props.freshness.profileCount} profiles current`
    : 'No active profiles';

  return (
    <div className="relative flex h-dvh min-h-[38rem] w-full min-w-[64rem] flex-col overflow-hidden bg-[#070709] text-white">
      <div aria-hidden className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_82%_2%,rgba(200,16,46,0.14),transparent_28%),radial-gradient(circle_at_8%_92%,rgba(37,99,235,0.08),transparent_30%)]" />
      <header className="relative z-10 flex h-[10.5vh] min-h-[5.5rem] shrink-0 items-center justify-between gap-6 border-b border-white/10 px-[2.3vw]">
        <div className="flex min-w-0 items-center gap-[1vw]">
          <span className="grid h-[clamp(2.6rem,3.4vw,4.4rem)] w-[clamp(2.6rem,3.4vw,4.4rem)] shrink-0 place-items-center rounded-[0.7vw] bg-accent-600 text-white shadow-[0_0_40px_rgba(200,16,46,0.2)]">
            <DumpsterMark className="h-[62%] w-[62%]" />
          </span>
          <div className="min-w-0">
            <div className="flex items-center gap-2.5">
              <p className="truncate text-[clamp(1.2rem,1.75vw,2.25rem)] font-semibold tracking-[-0.04em]">{props.landscape.name}</p>
              <span className="rounded-full border border-accent-500/40 bg-accent-600/15 px-2.5 py-1 text-[clamp(0.6rem,0.68vw,0.85rem)] font-bold uppercase tracking-[0.16em] text-accent-300">Newsroom live</span>
            </div>
            <p className="mt-0.5 truncate text-[clamp(0.7rem,0.85vw,1.05rem)] text-zinc-500">
              {props.scopeLabel} · {props.platformLabel} · {props.rangeLabel}
            </p>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-[1.4vw]">
          <div className="text-right">
            <div className="flex items-center justify-end gap-2 text-[clamp(0.75rem,0.9vw,1.1rem)] font-semibold text-zinc-300">
              <span className={cn('h-2.5 w-2.5 rounded-full shadow-[0_0_14px_currentColor]', freshnessToneClass(freshness.tone))} aria-hidden />
              {freshness.label}
            </div>
            <p className="mt-1 text-[clamp(0.62rem,0.72vw,0.9rem)] text-zinc-600">{freshRatio} · checks every 5m</p>
          </div>
          {props.errors.length > 0 ? (
            <span className="rounded-full border border-amber-400/30 bg-amber-400/10 px-3 py-1.5 text-[clamp(0.65rem,0.75vw,0.95rem)] font-semibold text-amber-300">
              {props.errors.length} data {props.errors.length === 1 ? 'warning' : 'warnings'}
            </span>
          ) : null}
          <div className="border-l border-white/10 pl-[1.4vw] text-right">
            <p className="pb-num text-[clamp(1rem,1.45vw,1.85rem)] font-semibold tracking-tight text-white">{CLOCK_FORMAT.format(now)}</p>
            <p className="mt-0.5 text-[clamp(0.62rem,0.7vw,0.88rem)] font-medium uppercase tracking-[0.14em] text-zinc-600">Boston time</p>
          </div>
        </div>
      </header>

      <main className="relative z-10 min-h-0 flex-1 px-[2.3vw] py-[1.5vw]" aria-live="polite" aria-label={SLIDES[slide].label}>
        {slide === 0 ? <LeaderboardSlide rows={props.recentEngagementRows} focusCompanyId={props.focusCompanyId} focusName={props.focusName} /> : null}
        {slide === 1 ? <PlatformWinnersSlide posts={props.topPosts} platforms={props.platforms} focusCompanyId={props.focusCompanyId} /> : null}
        {slide === 2 ? <PulseSlide summary={props.summary} rows={props.engagementRows} focusCompanyId={props.focusCompanyId} focusName={props.focusName} /> : null}
        {slide === 3 ? <ChannelSlide summary={props.summary} focusName={props.focusName} /> : null}
      </main>

      <footer className="relative z-10 flex h-[8vh] min-h-[4.25rem] shrink-0 items-center justify-between gap-5 border-t border-white/10 px-[2.3vw]">
        <div className="flex items-center gap-[0.8vw]">
          <Link href={props.exitHref} className="inline-flex h-10 items-center gap-2 rounded-full border border-white/10 bg-white/5 px-4 text-[clamp(0.65rem,0.75vw,0.95rem)] font-semibold text-zinc-400 transition-colors hover:bg-white/10 hover:text-white">
            <ArrowLeft className="h-4 w-4" aria-hidden />
            Exit screen
          </Link>
          <button type="button" onClick={() => router.refresh()} className="grid h-10 w-10 place-items-center rounded-full border border-white/10 bg-white/5 text-zinc-500 transition-colors hover:bg-white/10 hover:text-white" aria-label="Refresh display data">
            <RefreshCw className="h-4 w-4" aria-hidden />
          </button>
          <button type="button" onClick={toggleFullscreen} className="grid h-10 w-10 place-items-center rounded-full border border-white/10 bg-white/5 text-zinc-500 transition-colors hover:bg-white/10 hover:text-white" aria-label={fullscreen ? 'Exit fullscreen' : 'Enter fullscreen'}>
            {fullscreen ? <Minimize2 className="h-4 w-4" aria-hidden /> : <Maximize2 className="h-4 w-4" aria-hidden />}
          </button>
        </div>

        <div className="flex min-w-0 flex-1 items-center justify-center gap-[0.7vw]">
          <button type="button" onClick={() => goTo(slide - 1)} className="grid h-9 w-9 place-items-center rounded-full text-zinc-600 hover:bg-white/5 hover:text-white" aria-label="Previous newsroom slide">
            <ArrowLeft className="h-4 w-4" aria-hidden />
          </button>
          {SLIDES.map((item, index) => (
            <button
              key={item.id}
              type="button"
              onClick={() => goTo(index)}
              aria-label={`Show ${item.label}`}
              aria-current={slide === index ? 'step' : undefined}
              className={cn(
                'h-2 rounded-full transition-[width,background-color] duration-300',
                slide === index ? 'w-[3vw] min-w-10 bg-accent-500' : 'w-2 bg-zinc-800 hover:bg-zinc-600',
              )}
            />
          ))}
          <button type="button" onClick={() => goTo(slide + 1)} className="grid h-9 w-9 place-items-center rounded-full text-zinc-600 hover:bg-white/5 hover:text-white" aria-label="Next newsroom slide">
            <ArrowRight className="h-4 w-4" aria-hidden />
          </button>
        </div>

        <div className="flex items-center gap-[0.8vw]">
          <span className="hidden items-center gap-1.5 text-[clamp(0.62rem,0.7vw,0.88rem)] text-zinc-700 2xl:flex">
            <Clock3 className="h-3.5 w-3.5" aria-hidden />
            20s rotation
          </span>
          <button type="button" onClick={() => setPaused((value) => !value)} className="inline-flex h-10 items-center gap-2 rounded-full border border-white/10 bg-white/5 px-4 text-[clamp(0.65rem,0.75vw,0.95rem)] font-semibold text-zinc-400 transition-colors hover:bg-white/10 hover:text-white" aria-label={paused ? 'Resume slide rotation' : 'Pause slide rotation'}>
            {paused ? <Play className="h-4 w-4 fill-current" aria-hidden /> : <Pause className="h-4 w-4 fill-current" aria-hidden />}
            {paused ? 'Resume' : SLIDES[slide].label}
          </button>
        </div>
        <div className="absolute inset-x-0 top-0 h-px bg-white/5" aria-hidden>
          <div className="h-full bg-accent-500 transition-[width] duration-200" style={{ width: `${paused ? 0 : progress * 100}%` }} />
        </div>
      </footer>
    </div>
  );
}
