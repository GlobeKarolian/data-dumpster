'use client';

import * as React from 'react';
import { PLATFORM_COLORS, PLATFORM_LABELS, type Platform } from '@/lib/types';
import { ADAPTER_SUPPORTED_PLATFORMS } from '@/lib/adapters/supported-platforms';
import { packCircles, type PackInput } from '@/lib/stories/layout';
import { cn, compactNumber } from '@/lib/utils';
import { EmptyState } from '@/components/ui/empty-state';
import { ErrorState } from '@/components/ui/error-state';
import { MultiSelect } from '@/components/ui/multi-select';
import { Select } from '@/components/ui/select';
import { useUrlState } from '@/components/common/use-url-state';
import { formatDateTime, truncate } from '@/components/ui/format';
import { StoryDetail } from './story-detail';
import type { StoryCloudDto, StoryDto } from './types';
import { storySupportsCompetitiveConclusions } from '@/lib/stories/confidence';

/**
 * Bubble size is the square root of engagement.
 *
 * Area, not radius, is what the eye reads as quantity, so a story that earned a
 * hundred times more engagement should be ten times wider rather than a hundred
 * times wider. Anything else turns one viral post into the entire picture and
 * makes the rest of the market invisible.
 */
const R_MIN = 15;
const R_MAX = 94;

function radiusFor(engagement: number, max: number): number {
  if (max <= 0) return R_MIN;
  return Math.max(R_MIN, R_MAX * Math.sqrt(Math.max(engagement, 0) / max));
}

function n(value: number): string {
  return value.toFixed(2);
}

/** One slice of a pie-split bubble. Full circles are drawn as circles instead. */
function wedgePath(cx: number, cy: number, r: number, from: number, to: number): string {
  const x0 = cx + r * Math.cos(from);
  const y0 = cy + r * Math.sin(from);
  const x1 = cx + r * Math.cos(to);
  const y1 = cy + r * Math.sin(to);
  const large = to - from > Math.PI ? 1 : 0;
  return 'M ' + n(cx) + ' ' + n(cy) + ' L ' + n(x0) + ' ' + n(y0)
    + ' A ' + n(r) + ' ' + n(r) + ' 0 ' + large + ' 1 ' + n(x1) + ' ' + n(y1) + ' Z';
}

export interface PlatformShare { platform: Platform; share: number }

/**
 * Platform mix by engagement, falling back to post counts when a story earned
 * nothing at all. A zero-engagement story still happened and still deserves a
 * colour rather than a blank disc.
 */
function platformMix(story: StoryDto): PlatformShare[] {
  const totals = new Map<Platform, number>();
  let sum = 0;
  for (const post of story.posts) {
    const value = Math.max(post.engagementTotal, 0);
    totals.set(post.platform, (totals.get(post.platform) ?? 0) + value);
    sum += value;
  }
  if (sum <= 0) {
    totals.clear();
    for (const post of story.posts) totals.set(post.platform, (totals.get(post.platform) ?? 0) + 1);
    sum = story.posts.length;
  }
  if (sum <= 0) return [];
  return [...totals.entries()]
    .map(([platform, value]) => ({ platform, share: value / sum }))
    .sort((a, b) => b.share - a.share);
}

/** Greedy wrap sized to the chord width of the bubble, not its diameter. */
function labelLines(text: string, radius: number): string[] {
  const maxChars = Math.floor((radius * 1.7) / 6.1);
  const maxLines = radius >= 48 ? 3 : 2;
  if (maxChars < 7 || radius < 30) return [];
  const words = text.replace(/\s+/g, ' ').trim().split(' ').filter(Boolean);
  const lines: string[] = [];
  let current = '';
  for (const word of words) {
    if (lines.length >= maxLines) break;
    const next = current ? current + ' ' + word : word;
    if (next.length <= maxChars) { current = next; continue; }
    if (current) lines.push(current);
    current = word.length > maxChars ? word.slice(0, maxChars - 1) + '…' : word;
  }
  if (current && lines.length < maxLines) lines.push(current);
  return lines.slice(0, maxLines);
}

function spanLabel(startIso: string, endIso: string): string {
  const ms = new Date(endIso).getTime() - new Date(startIso).getTime();
  if (!Number.isFinite(ms) || ms <= 0) return 'a single moment';
  const hours = ms / 3_600_000;
  if (hours < 1) return Math.max(1, Math.round(ms / 60000)) + ' minutes';
  if (hours < 48) return Math.round(hours) + ' hours';
  return Math.round(hours / 24) + ' days';
}

const MIN_SIZE_OPTIONS = [2, 3, 4, 5, 6].map((v) => ({
  value: String(v),
  label: v + '+ posts',
}));

/**
 * Controls write to the URL rather than to component state, because every view
 * here is something somebody pastes into Slack to make an argument.
 */
function CloudControls({
  threshold,
  minSize,
  platforms,
  availablePlatforms,
}: {
  threshold: number;
  minSize: number;
  platforms: Platform[];
  availablePlatforms: Platform[];
}) {
  const { setParams } = useUrlState();
  const [pending, startTransition] = React.useTransition();
  const [draft, setDraft] = React.useState(threshold);

  // Reconcile the slider to a prop change without a setState in an effect:
  // remember the last prop we rendered against and correct during render.
  const [lastThreshold, setLastThreshold] = React.useState(threshold);
  if (lastThreshold !== threshold) {
    setLastThreshold(threshold);
    setDraft(threshold);
  }

  const commit = (value: number) => {
    if (Math.abs(value - threshold) < 0.001) return;
    startTransition(() => setParams({ threshold: value.toFixed(2) }, { replace: true }));
  };

  const options = (
    availablePlatforms.length > 0
      ? availablePlatforms
      : [...ADAPTER_SUPPORTED_PLATFORMS]
  ).map((p) => ({
    value: p,
    label: PLATFORM_LABELS[p],
    color: PLATFORM_COLORS[p],
    platform: p,
  }));

  return (
    <div className="flex flex-wrap items-end gap-4 rounded-lg border border-zinc-200 bg-white px-4 py-3 dark:border-zinc-800 dark:bg-zinc-900/40">
      <div className="min-w-[13rem]">
        <div className="flex items-baseline justify-between gap-2">
          <label htmlFor="story-tightness" className="text-[11px] font-medium text-zinc-600 dark:text-zinc-400">
            Tightness
          </label>
          <span className="pb-num text-[11px] text-zinc-400 dark:text-zinc-500">{draft.toFixed(2)}</span>
        </div>
        <input
          id="story-tightness"
          type="range"
          min={0.22}
          max={0.4}
          step={0.02}
          value={draft}
          onChange={(e) => setDraft(Number(e.target.value))}
          onMouseUp={(e) => commit(Number(e.currentTarget.value))}
          onTouchEnd={(e) => commit(Number(e.currentTarget.value))}
          onKeyUp={(e) => commit(Number(e.currentTarget.value))}
          className="mt-1.5 h-1 w-full cursor-pointer appearance-none rounded-full bg-zinc-200 accent-accent-600 dark:bg-zinc-800"
        />
        <div className="mt-1 flex justify-between text-[10px] text-zinc-400 dark:text-zinc-500">
          <span>Loose, fewer bigger stories</span>
          <span>Tight</span>
        </div>
      </div>

      <div className="w-36">
        <label htmlFor="story-min-size" className="block text-[11px] font-medium text-zinc-600 dark:text-zinc-400">
          Minimum size
        </label>
        <div className="mt-1.5">
          <Select
            id="story-min-size"
            size="sm"
            options={MIN_SIZE_OPTIONS}
            value={String(minSize)}
            onChange={(e) => startTransition(() => setParams({ minSize: e.target.value }, { replace: true }))}
          />
        </div>
      </div>

      <div className="w-48">
        <span className="block text-[11px] font-medium text-zinc-600 dark:text-zinc-400">Platforms</span>
        <div className="mt-1.5">
          <MultiSelect
            label="Platform"
            allLabel="All platforms"
            options={options}
            value={platforms}
            onChange={(next) => startTransition(() => setParams({ platforms: next }, { replace: true }))}
          />
        </div>
      </div>

      <p
        aria-live="polite"
        className={cn(
          'ml-auto max-w-xs text-[11px] leading-relaxed transition-colors',
          pending
            ? 'text-accent-600 dark:text-accent-500'
            : 'text-zinc-400 dark:text-zinc-500',
        )}
      >
        {pending
          ? 'Reclustering the window.'
          : 'Clustering is deterministic. The same window and settings always draw the same picture.'}
      </p>
    </div>
  );
}

/** Platform brands run from near-black to bright cyan, so pick the readable ink. */
function inkFor(hex: string): string {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex);
  if (!m) return '#ffffff';
  const v = parseInt(m[1], 16);
  const r = (v >> 16) & 255;
  const g = (v >> 8) & 255;
  const b = v & 255;
  const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return luminance > 0.62 ? '#18181b' : '#ffffff';
}

function StoryBubble({
  story,
  x,
  y,
  radius,
  mix,
  selected,
  active,
  onEnter,
  onLeave,
  onSelect,
}: {
  story: StoryDto;
  x: number;
  y: number;
  radius: number;
  mix: PlatformShare[];
  selected: boolean;
  active: boolean;
  onEnter: () => void;
  onLeave: () => void;
  onSelect: () => void;
}) {
  const outlets = story.companies.length;
  const crossOutlet = outlets > 1;
  const dominant = mix[0]?.platform ?? 'rss';
  const lines = labelLines(story.label, radius);
  const ink = inkFor(PLATFORM_COLORS[dominant]);

  let angle = -Math.PI / 2;

  return (
    <g
      role="button"
      tabIndex={0}
      aria-label={
        story.label + '. ' + outlets + ' outlets, ' + story.posts.length + ' posts, '
        + compactNumber(story.totalEngagement) + ' engagement.'
      }
      className="cursor-pointer outline-none"
      onMouseEnter={onEnter}
      onMouseLeave={onLeave}
      onFocus={onEnter}
      onBlur={onLeave}
      onClick={onSelect}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onSelect(); }
      }}
    >
      {mix.length <= 1 ? (
        <circle cx={x} cy={y} r={radius} fill={PLATFORM_COLORS[dominant]} fillOpacity={active ? 0.98 : 0.86} />
      ) : (
        mix.map((slice) => {
          const from = angle;
          const to = angle + slice.share * Math.PI * 2;
          angle = to;
          return (
            <path
              key={slice.platform}
              d={wedgePath(x, y, radius, from, to)}
              fill={PLATFORM_COLORS[slice.platform]}
              fillOpacity={active ? 0.98 : 0.86}
            />
          );
        })
      )}

      {crossOutlet && outlets > 2 ? (
        <circle
          cx={x}
          cy={y}
          r={radius + 3.5}
          fill="none"
          stroke="currentColor"
          strokeWidth={1}
          strokeDasharray="2 3"
          className="text-zinc-400 dark:text-zinc-500"
        />
      ) : null}

      <circle
        cx={x}
        cy={y}
        r={radius}
        fill="none"
        stroke={selected ? '#C8102E' : 'currentColor'}
        strokeWidth={selected ? 2.75 : crossOutlet ? 1.75 : 0.75}
        strokeOpacity={selected ? 1 : crossOutlet ? 0.95 : 0.45}
        className={cn(
          'transition-[stroke-width]',
          selected ? '' : crossOutlet ? 'text-zinc-900 dark:text-zinc-50' : 'text-zinc-500 dark:text-zinc-500',
        )}
      />

      {lines.length > 0 ? (
        <text
          textAnchor="middle"
          fontSize={radius >= 56 ? 12 : 10.5}
          fill={ink}
          className="pointer-events-none select-none font-medium"
        >
          {lines.map((line, i) => (
            <tspan key={line + i} x={x} y={y + (i - (lines.length - 1) / 2) * (radius >= 56 ? 13.5 : 12) - 2}>
              {line}
            </tspan>
          ))}
        </text>
      ) : null}
    </g>
  );
}

function BubbleTooltip({ story, mix }: { story: StoryDto; mix: PlatformShare[] }) {
  const supportsConclusions = storySupportsCompetitiveConclusions(
    story.cohesion,
    story.companies.length,
  );
  return (
    <div className="w-72 rounded-md border border-zinc-200 bg-white p-3 text-left shadow-lg dark:border-zinc-700 dark:bg-zinc-900">
      <p className="text-xs font-semibold leading-snug text-zinc-900 dark:text-zinc-100">
        {truncate(story.label, 120)}
      </p>
      <dl className="mt-2 grid grid-cols-3 gap-2">
        <div>
          <dt className="text-[10px] uppercase tracking-wider text-zinc-400">Outlets</dt>
          <dd className="pb-num text-xs font-semibold text-zinc-900 dark:text-zinc-100">
            {story.companies.length}
          </dd>
        </div>
        <div>
          <dt className="text-[10px] uppercase tracking-wider text-zinc-400">Posts</dt>
          <dd className="pb-num text-xs font-semibold text-zinc-900 dark:text-zinc-100">
            {story.posts.length}
          </dd>
        </div>
        <div>
          <dt className="text-[10px] uppercase tracking-wider text-zinc-400">Engagement</dt>
          <dd className="pb-num text-xs font-semibold text-zinc-900 dark:text-zinc-100">
            {compactNumber(story.totalEngagement)}
          </dd>
        </div>
      </dl>
      <p className="mt-2 text-[11px] leading-relaxed text-zinc-600 dark:text-zinc-400">
        {supportsConclusions && story.brokeBy
          ? 'Broken by ' + story.brokeBy.name + ' on ' + formatDateTime(story.firstPostedAt) + '.'
          : 'Competitive timing conclusions are withheld for this grouping.'}
      </p>
      <p className="mt-1 text-[11px] leading-relaxed text-zinc-500 dark:text-zinc-500">
        {'Ran ' + spanLabel(story.firstPostedAt, story.lastPostedAt) + ' · '
          + mix.map((m) => PLATFORM_LABELS[m.platform]).join(', ')}
      </p>
      <p className="mt-1.5 text-[10px] font-medium uppercase tracking-wider text-accent-600 dark:text-accent-500">
        Click to open
      </p>
    </div>
  );
}

/** The right-hand column before anything is selected. Ranked, not decorative. */
function StoryShortlist({
  stories,
  onSelect,
}: {
  stories: StoryDto[];
  onSelect: (id: string) => void;
}) {
  const crossOutlet = stories.filter((story) =>
    storySupportsCompetitiveConclusions(story.cohesion, story.companies.length)).slice(0, 6);
  const shown = crossOutlet.length > 0 ? crossOutlet : stories.slice(0, 6);

  return (
    <aside className="rounded-lg border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900/40">
      <header className="border-b border-zinc-200 px-4 py-3 dark:border-zinc-800">
        <h3 className="text-sm font-semibold tracking-tight text-zinc-900 dark:text-zinc-100">
          {crossOutlet.length > 0 ? 'Covered by more than one outlet' : 'Biggest stories'}
        </h3>
        <p className="mt-0.5 text-[11px] leading-relaxed text-zinc-500 dark:text-zinc-400">
          {crossOutlet.length > 0
            ? 'The stories the market chased together. Pick one to see who got there first.'
            : 'Nothing in this window was covered by two outlets at once.'}
        </p>
      </header>
      <ol className="divide-y divide-zinc-200 dark:divide-zinc-800">
        {shown.map((story, index) => (
          <li key={story.id}>
            <button
              type="button"
              onClick={() => onSelect(story.id)}
              className="flex w-full items-start gap-2 px-4 py-2.5 text-left transition-colors hover:bg-zinc-50 dark:hover:bg-zinc-800/50"
            >
              <span className="pb-num mt-0.5 w-4 shrink-0 text-[11px] text-zinc-400">{index + 1}</span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-xs font-medium text-zinc-900 dark:text-zinc-100">
                  {truncate(story.label, 70)}
                </span>
                <span className="pb-num mt-0.5 block text-[11px] text-zinc-500 dark:text-zinc-500">
                  {story.companies.length + ' outlets · ' + story.posts.length + ' posts · '
                    + compactNumber(story.totalEngagement)}
                </span>
                {story.brokeBy && storySupportsCompetitiveConclusions(
                  story.cohesion,
                  story.companies.length,
                ) ? (
                  <span className="mt-0.5 block truncate text-[11px] text-zinc-400 dark:text-zinc-500">
                    {'Broken by ' + story.brokeBy.name}
                  </span>
                ) : null}
              </span>
            </button>
          </li>
        ))}
      </ol>
    </aside>
  );
}

export interface StoryCloudProps {
  cloud: StoryCloudDto;
  threshold: number;
  minSize: number;
  platforms: Platform[];
  availablePlatforms: Platform[];
  error?: string | null;
}

/**
 * The Story Cloud.
 *
 * One bubble per real-world event several newsrooms covered. Size is how much
 * engagement the market earned on it, colour is where it happened, and the
 * emphasised outline marks the stories more than one outlet chased, which are
 * the only ones a competitive newsroom argues about.
 */
export function StoryCloud({
  cloud,
  threshold,
  minSize,
  platforms,
  availablePlatforms,
  error,
}: StoryCloudProps) {
  const clusters = cloud.clusters;
  const [selectedId, setSelectedId] = React.useState<string | null>(null);
  const [hoveredId, setHoveredId] = React.useState<string | null>(null);

  const byId = React.useMemo(() => {
    const map = new Map<string, StoryDto>();
    for (const c of clusters) map.set(c.id, c);
    return map;
  }, [clusters]);

  const mixes = React.useMemo(() => {
    const map = new Map<string, PlatformShare[]>();
    for (const c of clusters) map.set(c.id, platformMix(c));
    return map;
  }, [clusters]);

  const layout = React.useMemo(() => {
    const max = clusters.reduce((m, c) => Math.max(m, c.totalEngagement), 0);
    const inputs: PackInput[] = clusters.map((c) => ({
      id: c.id,
      radius: radiusFor(c.totalEngagement, max),
    }));
    return packCircles(inputs, 6);
  }, [clusters]);

  // A selection that no longer exists after a filter change is stale rather
  // than wrong, so resolve it during render instead of clearing it in an
  // effect. Reading through byId means one render, not two.
  const activeSelectedId = selectedId && byId.has(selectedId) ? selectedId : null;
  const activeHoveredId = hoveredId && byId.has(hoveredId) ? hoveredId : null;

  const legend = React.useMemo(() => {
    const seen = new Set<Platform>();
    for (const c of clusters) for (const p of c.platforms) seen.add(p);
    return [...seen];
  }, [clusters]);

  const selected = activeSelectedId ? byId.get(activeSelectedId) ?? null : null;
  const hovered = activeHoveredId ? byId.get(activeHoveredId) ?? null : null;
  const hoveredCircle = activeHoveredId
    ? layout.circles.find((c) => c.id === activeHoveredId) ?? null
    : null;
  const crossOutletCount = clusters.filter((c) => c.companies.length > 1).length;
  const tooltipBelow = hoveredCircle ? hoveredCircle.y - hoveredCircle.radius < layout.height * 0.22 : false;

  const controls = (
    <CloudControls
      threshold={threshold}
      minSize={minSize}
      platforms={platforms}
      availablePlatforms={availablePlatforms}
    />
  );

  if (error) {
    return (
      <div className="space-y-4">
        {controls}
        <ErrorState message={error} />
      </div>
    );
  }

  if (clusters.length === 0) {
    return (
      <div className="space-y-4">
        {controls}
        <div className="rounded-lg border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900/40">
          <EmptyState
            title="No stories in this window"
            description={
              cloud.postCount === 0
                ? 'There are no posts in this landscape and window to cluster. Widen the date range, or connect channels and refresh the data.'
                : 'All ' + cloud.postCount + ' posts in this window stayed on their own. Loosen the tightness slider or lower the minimum size, or widen the window so coverage of the same event can find itself.'
            }
            action={cloud.postCount === 0 ? { label: 'Connect channels', href: '/settings/sources' } : undefined}
          />
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {controls}
      <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_21rem]">
        <section className="min-w-0 rounded-lg border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900/40">
          <header className="flex flex-wrap items-center justify-between gap-3 border-b border-zinc-200 px-4 py-3 dark:border-zinc-800">
            <div className="min-w-0">
              <h2 className="text-sm font-semibold tracking-tight text-zinc-900 dark:text-zinc-100">
                {clusters.length + ' stories'}
              </h2>
              <p className="pb-num mt-0.5 text-[11px] text-zinc-500 dark:text-zinc-400">
                {crossOutletCount + ' covered by more than one outlet · '
                  + (cloud.postCount - cloud.unclusteredCount) + ' of ' + cloud.postCount
                  + ' posts clustered'}
              </p>
            </div>
            <ul className="flex flex-wrap items-center gap-x-3 gap-y-1">
              {legend.map((p) => (
                <li key={p} className="flex items-center gap-1.5 text-[11px] text-zinc-500 dark:text-zinc-400">
                  <span
                    aria-hidden
                    className="h-2 w-2 rounded-full"
                    style={{ backgroundColor: PLATFORM_COLORS[p] }}
                  />
                  {PLATFORM_LABELS[p]}
                </li>
              ))}
            </ul>
          </header>

          <div className="overflow-x-auto p-4">
            <div
              className="relative mx-auto"
              style={{ maxWidth: Math.max(Math.round(layout.width), 320) }}
            >
              <svg
                viewBox={'0 0 ' + n(layout.width) + ' ' + n(layout.height)}
                preserveAspectRatio="xMidYMid meet"
                role="group"
                aria-label="Stories sized by total engagement"
                className="block h-auto w-full"
              >
                {layout.circles.map((circle) => {
                  const story = byId.get(circle.id);
                  if (!story) return null;
                  return (
                    <StoryBubble
                      key={circle.id}
                      story={story}
                      x={circle.x}
                      y={circle.y}
                      radius={circle.radius}
                      mix={mixes.get(circle.id) ?? []}
                      selected={activeSelectedId === circle.id}
                      active={activeHoveredId === circle.id || activeSelectedId === circle.id}
                      onEnter={() => setHoveredId(circle.id)}
                      onLeave={() => setHoveredId((cur) => (cur === circle.id ? null : cur))}
                      onSelect={() => setSelectedId(circle.id)}
                    />
                  );
                })}
              </svg>

              {hovered && hoveredCircle ? (
                <div
                  className={cn(
                    'pointer-events-none absolute z-20',
                    tooltipBelow ? '-translate-x-1/2 translate-y-2' : '-translate-x-1/2 -translate-y-[calc(100%+0.5rem)]',
                  )}
                  style={{
                    left: (hoveredCircle.x / layout.width) * 100 + '%',
                    top:
                      ((tooltipBelow
                        ? hoveredCircle.y + hoveredCircle.radius
                        : hoveredCircle.y - hoveredCircle.radius) /
                        layout.height) *
                        100 +
                      '%',
                  }}
                >
                  <BubbleTooltip story={hovered} mix={mixes.get(hovered.id) ?? []} />
                </div>
              ) : null}
            </div>
          </div>

          <p className="border-t border-zinc-200 px-4 py-2 text-[11px] leading-relaxed text-zinc-500 dark:border-zinc-800 dark:text-zinc-500">
            Width is the square root of total engagement, so area tracks engagement directly and a
            story worth a hundred times more is ten times wider. The smallest stories are held at a
            floor so they stay clickable. A heavy outline means two or more outlets covered it; a
            dashed ring means three or more did.
          </p>
        </section>

        {selected ? (
          <StoryDetail story={selected} onClose={() => setSelectedId(null)} className="lg:sticky lg:top-20" />
        ) : (
          <StoryShortlist stories={clusters} onSelect={setSelectedId} />
        )}
      </div>
    </div>
  );
}
