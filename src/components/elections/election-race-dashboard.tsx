'use client';

import * as React from 'react';
import { Activity, BarChart3, Eye, Newspaper, TrendingUp, Users } from 'lucide-react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip as ChartTooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { TopPostsPanel } from '@/components/overview/top-posts';
import { Badge } from '@/components/ui/badge';
import { Card, CardBody, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { PlatformIcon } from '@/components/ui/platform-icon';
import { TabPanel, Tabs } from '@/components/ui/tabs';
import type { ElectionCandidateRecord, ElectionRaceAnalytics, ElectionRaceDetail } from '@/lib/elections/types';
import type { TimeSeriesResult } from '@/lib/metrics/contract';
import type { MetricRow, Platform } from '@/lib/types';
import { PLATFORM_COLORS, PLATFORM_LABELS } from '@/lib/types';
import { cn, compactNumber, formatChange } from '@/lib/utils';

const METRIC_TABS = [
  { id: 'overview', label: 'State of the field' },
  { id: 'topics', label: 'Topics' },
  { id: 'content', label: 'Top content' },
  { id: 'candidates', label: 'Candidate profiles' },
  { id: 'compare', label: 'Head-to-head' },
];

const PLATFORM_ORDER: Platform[] = [
  'facebook', 'instagram', 'linkedin', 'youtube', 'twitter', 'tiktok',
  'threads', 'bluesky', 'truth_social', 'reddit',
];

const number = new Intl.NumberFormat('en-US');
const day = new Intl.DateTimeFormat('en-US', {
  month: 'short',
  day: 'numeric',
  timeZone: 'UTC',
});

function readableDay(value: string): string {
  return day.format(new Date(value + 'T12:00:00Z'));
}

function periodLabel(analytics: ElectionRaceAnalytics): string {
  return analytics.range.days === 1 ? '1 day' : analytics.range.days + ' days';
}

function candidateFor(row: MetricRow, race: ElectionRaceDetail): ElectionCandidateRecord | undefined {
  return race.candidates.find((candidate) => candidate.companyId === row.company.id);
}

function colorFor(
  candidate: ElectionCandidateRecord | undefined,
  fallback: string | null | undefined,
): string {
  return candidate?.color ?? fallback ?? '#52525b';
}

function CandidateMark({ candidate, row, size = 'md' }: {
  candidate?: ElectionCandidateRecord;
  row?: MetricRow;
  size?: 'sm' | 'md' | 'lg';
}) {
  const name = candidate?.name ?? row?.company.name ?? 'Candidate';
  const image = candidate?.logoUrl ?? row?.company.logoUrl;
  const color = colorFor(candidate, row?.company.color);
  const dimensions = size === 'sm'
    ? 'h-7 w-7 text-[10px]'
    : size === 'lg'
      ? 'h-14 w-14 text-base'
      : 'h-9 w-9 text-xs';
  if (image) {
    return (
      // Campaign avatars can come from many CDNs, so a fixed next/image allowlist is not dependable.
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={image}
        alt=""
        className={cn('shrink-0 rounded-full object-cover', dimensions)}
        referrerPolicy="no-referrer"
      />
    );
  }
  return (
    <span
      aria-hidden
      className={cn('grid shrink-0 place-items-center rounded-full font-semibold text-white', dimensions)}
      style={{ backgroundColor: color }}
    >
      {name.split(/\s+/).map((part) => part[0]).slice(0, 2).join('')}
    </span>
  );
}

function totalAvailable(rows: MetricRow[]): number | null {
  const measured = rows.filter((row) => row.available);
  return measured.length ? measured.reduce((sum, row) => sum + row.value, 0) : null;
}

function rowFor(rows: MetricRow[], companyId: string): MetricRow | undefined {
  return rows.find((row) => row.company.id === companyId);
}

function MetricDelta({ row }: { row?: MetricRow }) {
  if (!row?.available) return <span className="text-zinc-400">Not measured</span>;
  if (row.complete === false) {
    return <span className="text-amber-700 dark:text-amber-400">Partial coverage</span>;
  }
  const delta = formatChange(row.changePct);
  if (delta.tone === 'na') {
    return <span className="text-zinc-400">No comparable prior period</span>;
  }
  return (
    <span className={
      delta.tone === 'up'
        ? 'text-emerald-700 dark:text-emerald-400'
        : delta.tone === 'down'
          ? 'text-red-700 dark:text-red-400'
          : 'text-zinc-500'
    }>
      {delta.label} vs prior equal-length period
    </span>
  );
}

function seriesCompanies(
  result: TimeSeriesResult,
  race: ElectionRaceDetail,
  companyIds?: Set<string>,
) {
  return result.companies.filter((company) => (
    race.candidates.some((candidate) => candidate.companyId === company.id)
    && (!companyIds || companyIds.has(company.id))
  ));
}

function TrendChart({
  title,
  description,
  result,
  race,
  companyIds,
  mode = 'line',
  emptyText,
}: {
  title: string;
  description: string;
  result: TimeSeriesResult;
  race: ElectionRaceDetail;
  companyIds?: Set<string>;
  mode?: 'line' | 'bar';
  emptyText: string;
}) {
  const companies = seriesCompanies(result, race, companyIds);
  const axes = (
    <>
      <CartesianGrid stroke="var(--pb-grid)" vertical={false} />
      <XAxis
        dataKey="date"
        tickFormatter={readableDay}
        minTickGap={24}
        tick={{ fill: 'var(--pb-label)', fontSize: 10 }}
        tickLine={false}
        axisLine={false}
      />
      <YAxis
        width={50}
        allowDecimals={mode !== 'bar'}
        tickFormatter={(value) => compactNumber(Number(value))}
        tick={{ fill: 'var(--pb-label)', fontSize: 10 }}
        tickLine={false}
        axisLine={false}
      />
      <ChartTooltip
        formatter={(value) => number.format(Number(value))}
        labelFormatter={(label) => readableDay(String(label))}
        contentStyle={{
          borderColor: 'var(--pb-grid)',
          background: 'var(--pb-surface)',
          borderRadius: 6,
          fontSize: 11,
        }}
        labelStyle={{ color: 'var(--pb-label)', fontWeight: 600 }}
      />
    </>
  );

  return (
    <Card>
      <CardHeader>
        <div>
          <CardTitle>{title}</CardTitle>
          <CardDescription className="mt-1">{description}</CardDescription>
        </div>
        <Badge tone="outline">{result.granularity}</Badge>
      </CardHeader>
      <CardBody>
        {companies.length > 1 ? (
          <div className="mb-3 flex flex-wrap gap-x-4 gap-y-2">
            {companies.map((company) => {
              const candidate = race.candidates.find((item) => item.companyId === company.id);
              return (
                <span
                  key={company.id}
                  className="inline-flex items-center gap-1.5 text-[11px] text-zinc-600 dark:text-zinc-400"
                >
                  <span
                    className="h-2 w-2 rounded-full"
                    style={{ backgroundColor: colorFor(candidate, company.color) }}
                  />
                  {company.name}
                </span>
              );
            })}
          </div>
        ) : null}
        <div className="h-[300px] min-w-0">
          {result.series.length && companies.length ? (
            <ResponsiveContainer width="100%" height="100%">
              {mode === 'bar' ? (
                <BarChart data={result.series} margin={{ top: 8, right: 8, bottom: 0, left: -8 }}>
                  {axes}
                  {companies.map((company) => {
                    const candidate = race.candidates.find((item) => item.companyId === company.id);
                    return (
                      <Bar
                        key={company.id}
                        dataKey={company.id}
                        name={company.name}
                        stackId="race-posts"
                        fill={colorFor(candidate, company.color)}
                        radius={[2, 2, 0, 0]}
                      />
                    );
                  })}
                </BarChart>
              ) : (
                <LineChart data={result.series} margin={{ top: 8, right: 8, bottom: 0, left: -8 }}>
                  {axes}
                  {companies.map((company) => {
                    const candidate = race.candidates.find((item) => item.companyId === company.id);
                    return (
                      <Line
                        key={company.id}
                        type="monotone"
                        dataKey={company.id}
                        name={company.name}
                        stroke={colorFor(candidate, company.color)}
                        strokeWidth={2.25}
                        dot={false}
                        activeDot={{ r: 4 }}
                        connectNulls={false}
                      />
                    );
                  })}
                </LineChart>
              )}
            </ResponsiveContainer>
          ) : (
            <div className="grid h-full place-items-center text-xs text-zinc-500">{emptyText}</div>
          )}
        </div>
      </CardBody>
    </Card>
  );
}

function OverviewView({ race, analytics }: {
  race: ElectionRaceDetail;
  analytics: ElectionRaceAnalytics;
}) {
  const engagement = totalAvailable(analytics.engagementTotal);
  const audience = totalAvailable(analytics.audience);
  const postCount = totalAvailable(analytics.posts);
  const viewCount = totalAvailable(analytics.views);
  const ranking = analytics.engagementTotal.filter((row) => row.available);
  const peak = Math.max(1, ...ranking.map((row) => row.value));
  const shareRows = analytics.shareOfEngagement.filter((row) => row.available && row.value > 0);
  const rankedCompanyIds = new Set(ranking.slice(0, 10).map((row) => row.company.id));

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
        {[
          { label: 'Candidates tracked', value: String(race.candidates.length), note: 'campaign entities in this race', icon: Users },
          { label: 'Engagement · ' + periodLabel(analytics), value: compactNumber(engagement), note: engagement === null ? 'Waiting for collected posts' : number.format(engagement) + ' measured interactions', icon: Activity },
          { label: 'Combined audience', value: compactNumber(audience), note: audience === null ? 'Waiting for audience snapshots' : number.format(audience) + ' latest followers', icon: TrendingUp },
          { label: 'Posts published', value: compactNumber(postCount), note: postCount === null ? 'Waiting for collected posts' : number.format(postCount) + ' collected posts', icon: Newspaper },
          { label: 'Video views', value: compactNumber(viewCount), note: viewCount === null ? 'No view observations in this window' : number.format(viewCount) + ' captured views', icon: Eye },
        ].map(({ label, value, note, icon: Icon }) => (
          <Card key={label}>
            <CardBody className="flex items-start justify-between gap-3">
              <div>
                <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-zinc-500">{label}</p>
                <strong className="pb-num mt-2 block text-2xl tracking-tight">{value}</strong>
                <p className="mt-1 text-[11px] text-zinc-500">{note}</p>
              </div>
              <span className="grid h-8 w-8 place-items-center rounded-full bg-zinc-100 text-zinc-500 dark:bg-zinc-800">
                <Icon className="h-4 w-4" />
              </span>
            </CardBody>
          </Card>
        ))}
      </div>

      <div className="grid gap-4 xl:grid-cols-[minmax(20rem,0.85fr)_minmax(28rem,1.15fr)]">
        <Card>
          <CardHeader>
            <div>
              <CardTitle>Engagement ranking</CardTitle>
              <CardDescription className="mt-1">Total measurable engagement, highest to lowest.</CardDescription>
            </div>
            <Badge tone="outline">{periodLabel(analytics)}</Badge>
          </CardHeader>
          <div className="divide-y divide-zinc-100 dark:divide-zinc-800/60">
            {ranking.length ? ranking.map((row) => {
              const candidate = candidateFor(row, race);
              return (
                <div key={row.company.id} className="grid grid-cols-[1.25rem_minmax(0,1fr)_auto] items-center gap-3 px-4 py-3">
                  <span className="pb-num text-center text-[11px] text-zinc-400">{row.rank}</span>
                  <div className="flex min-w-0 items-center gap-2.5">
                    <CandidateMark candidate={candidate} row={row} size="sm" />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-xs font-semibold">{row.company.name}</p>
                      <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-zinc-100 dark:bg-zinc-800">
                        <div className="h-full rounded-full" style={{ width: Math.max(2, (row.value / peak) * 100) + '%', backgroundColor: colorFor(candidate, row.company.color) }} />
                      </div>
                    </div>
                  </div>
                  <div className="text-right">
                    <p className="pb-num text-sm font-semibold">{compactNumber(row.value)}</p>
                    <p className="mt-0.5 text-[9px]"><MetricDelta row={row} /></p>
                  </div>
                </div>
              );
            }) : <p className="px-4 py-8 text-center text-xs text-zinc-500">Engagement appears after the first profile collections finish.</p>}
          </div>
        </Card>

        <TrendChart
          title="Engagement momentum"
          description="Interactions over time for the ten engagement leaders in the selected window."
          result={analytics.engagementSeries}
          race={race}
          companyIds={rankedCompanyIds}
          emptyText="Engagement trends appear after posts are collected."
        />

        <TrendChart
          title="Lookup attention (Wikipedia)"
          description="Daily human views of each candidate's Wikipedia article, from the official Wikimedia API with bot traffic excluded. A proxy for name interest — people hear a name and look it up — not search volume or polling."
          result={analytics.attentionSeries}
          race={race}
          companyIds={rankedCompanyIds}
          emptyText="Attention data appears once candidates are mapped to their Wikipedia articles."
        />
      </div>

      <div className="grid gap-4 xl:grid-cols-2">
        <TrendChart
          title="Publishing pace"
          description="Candidate posts over time, stacked to show the race's total output and who supplied it."
          result={analytics.postSeries}
          race={race}
          companyIds={rankedCompanyIds}
          mode="bar"
          emptyText="Publishing activity appears after posts are collected."
        />
        <TrendChart
          title="Video-view momentum"
          description="Captured views over time where the source platform supplies a reliable view count."
          result={analytics.viewSeries}
          race={race}
          companyIds={rankedCompanyIds}
          emptyText="View trends appear when platforms supply video-view observations."
        />
      </div>

      <Card>
        <CardHeader>
          <div>
            <CardTitle>Share of engagement</CardTitle>
            <CardDescription className="mt-1">Who captured the race&apos;s measurable social engagement in this window.</CardDescription>
          </div>
          <BarChart3 className="h-4 w-4 text-zinc-400" />
        </CardHeader>
        <CardBody className="space-y-3">
          {shareRows.length ? (
            <>
              <div className="flex h-9 w-full overflow-hidden rounded-md" aria-label="Share of engagement by candidate">
                {shareRows.map((row) => {
                  const candidate = candidateFor(row, race);
                  const percentage = row.value * 100;
                  return (
                    <div
                      key={row.company.id}
                      className="grid min-w-0 place-items-center border-r border-white/50 text-[10px] font-semibold text-white last:border-r-0"
                      style={{ width: percentage + '%', backgroundColor: colorFor(candidate, row.company.color) }}
                      title={row.company.name + ': ' + percentage.toFixed(1) + '% (' + number.format(rowFor(analytics.engagementTotal, row.company.id)?.value ?? 0) + ' engagements)'}
                    >
                      {percentage >= 12 ? percentage.toFixed(1) + '%' : ''}
                    </div>
                  );
                })}
              </div>
              <div className="flex flex-wrap gap-x-5 gap-y-2">
                {shareRows.map((row) => {
                  const candidate = candidateFor(row, race);
                  return (
                    <span key={row.company.id} className="inline-flex items-center gap-1.5 text-[11px] text-zinc-600 dark:text-zinc-400">
                      <span className="h-2 w-2 rounded-full" style={{ backgroundColor: colorFor(candidate, row.company.color) }} />
                      {row.company.name} <span className="pb-num text-zinc-400">{(row.value * 100).toFixed(1)}%</span>
                    </span>
                  );
                })}
              </div>
            </>
          ) : <p className="py-6 text-center text-xs text-zinc-500">Share appears once at least one candidate has measurable engagement.</p>}
        </CardBody>
      </Card>

      <TopPostsPanel
        posts={analytics.topPosts}
        title="Top content driving the race"
        scopeLabel={race.name}
        landscapeId={race.landscapeId}
        href="/posts"
        perPlatform={3}
      />
    </div>
  );
}

/**
 * What the race is actually about.
 *
 * Every number here counts posts the AI tagging pipeline has read and
 * classified. That is a different denominator from the rest of the tracker, so
 * the coverage line states it rather than letting a reader assume the topic
 * mix covers every post in the window.
 */
function TopicsView({ race, analytics }: {
  race: ElectionRaceDetail;
  analytics: ElectionRaceAnalytics;
}) {
  const { topics } = analytics;
  const palette = ['#C8102E', '#2563EB', '#0D9488', '#D97706', '#7C3AED', '#DB2777', '#65A30D', '#0891B2'];
  const colorFor = (index: number, tagColor: string | null) => tagColor ?? palette[index % palette.length];

  if (topics.tags.length === 0) {
    return (
      <Card>
        <CardBody>
          <p className="py-8 text-center text-xs text-zinc-500">
            {topics.totalPosts === 0
              ? 'No candidate posts in this window yet.'
              : 'The tagging pipeline has not read these posts yet. Topics appear as it works through the window.'}
          </p>
        </CardBody>
      </Card>
    );
  }

  const coveragePct = topics.totalPosts > 0
    ? Math.round((topics.taggedPosts / topics.totalPosts) * 100)
    : 0;
  const maxTag = topics.tags[0]?.posts ?? 1;

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <div>
            <CardTitle>What the field talks about</CardTitle>
            <CardDescription>
              {'Posts classified by topic across all candidates, ' + periodLabel(analytics) + '. '
                + 'A post can carry several topics.'}
            </CardDescription>
          </div>
          <Badge tone={coveragePct >= 80 ? 'accent' : 'warning'}>
            {number.format(topics.taggedPosts) + ' of ' + number.format(topics.totalPosts) + ' posts read · ' + coveragePct + '%'}
          </Badge>
        </CardHeader>
        <CardBody>
          <ul className="space-y-2">
            {topics.tags.map((tag, index) => (
              <li key={tag.id} className="flex items-center gap-3">
                <span className="w-44 shrink-0 truncate text-xs font-medium text-zinc-800 dark:text-zinc-200" title={tag.name}>
                  {tag.name}
                </span>
                <span className="h-2 min-w-0 flex-1 overflow-hidden rounded-full bg-zinc-100 dark:bg-zinc-800">
                  <span
                    className="block h-full rounded-full"
                    style={{
                      width: Math.max(2, (tag.posts / maxTag) * 100) + '%',
                      backgroundColor: colorFor(index, tag.color),
                    }}
                  />
                </span>
                <span className="pb-num w-14 shrink-0 text-right text-xs tabular-nums text-zinc-500">
                  {number.format(tag.posts)}
                </span>
              </li>
            ))}
          </ul>
        </CardBody>
      </Card>

      {topics.series.length > 1 ? (
        <Card>
          <CardHeader>
            <div>
              <CardTitle>Topics over time</CardTitle>
              <CardDescription>
                Tagged posts per day. Where a line climbs, the field moved onto that subject.
              </CardDescription>
            </div>
          </CardHeader>
          <CardBody>
            <div className="h-72 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={topics.series} margin={{ top: 6, right: 12, bottom: 0, left: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="currentColor" className="text-zinc-200 dark:text-zinc-800" vertical={false} />
                  <XAxis
                    dataKey="date"
                    tickFormatter={(value: string) => readableDay(value)}
                    tick={{ fontSize: 11 }}
                    stroke="currentColor"
                    className="text-zinc-400"
                    tickLine={false}
                    axisLine={false}
                    minTickGap={24}
                  />
                  <YAxis
                    tick={{ fontSize: 11 }}
                    stroke="currentColor"
                    className="text-zinc-400"
                    tickLine={false}
                    axisLine={false}
                    width={38}
                    allowDecimals={false}
                  />
                  <ChartTooltip
                    labelFormatter={(value) => readableDay(String(value))}
                    formatter={(value, key) => [
                      number.format(Number(value ?? 0)) + ' posts',
                      topics.tags.find((tag) => tag.id === String(key))?.name ?? String(key),
                    ]}
                    contentStyle={{ fontSize: 12, borderRadius: 8 }}
                  />
                  {topics.tags.map((tag, index) => (
                    <Line
                      key={tag.id}
                      type="monotone"
                      dataKey={tag.id}
                      name={tag.name}
                      stroke={colorFor(index, tag.color)}
                      strokeWidth={2}
                      dot={false}
                      connectNulls
                    />
                  ))}
                </LineChart>
              </ResponsiveContainer>
            </div>
            <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1.5">
              {topics.tags.map((tag, index) => (
                <span key={tag.id} className="inline-flex items-center gap-1.5 text-[11px] text-zinc-600 dark:text-zinc-400">
                  <span aria-hidden className="h-2 w-2 rounded-full" style={{ backgroundColor: colorFor(index, tag.color) }} />
                  {tag.name}
                </span>
              ))}
            </div>
          </CardBody>
        </Card>
      ) : null}

      {topics.diffusion.length > 0 ? (
        <Card>
          <CardHeader>
            <div>
              <CardTitle>How a topic moved through the field</CardTitle>
              <CardDescription>
                Each topic&rsquo;s busiest day, who posted on it earliest that day, and what
                everyone else posted on it in the week either side.
              </CardDescription>
            </div>
          </CardHeader>
          <CardBody className="space-y-5">
            {topics.diffusion.map((entry) => {
              const firstCandidate = entry.firstCompanyId
                ? race.candidates.find((c) => c.companyId === entry.firstCompanyId)
                : undefined;
              const firstRow = entry.firstCompanyId
                ? rowFor(analytics.engagementTotal, entry.firstCompanyId)
                : undefined;
              const firstName = firstCandidate?.name ?? firstRow?.company.name ?? null;
              const followers = entry.participants.filter((p) => p.increased
                && p.companyId !== entry.firstCompanyId);
              const steady = entry.participants.filter((p) => !p.increased
                && p.companyId !== entry.firstCompanyId);
              return (
                <div key={entry.tag.id} className="border-t border-zinc-100 pt-4 first:border-0 first:pt-0 dark:border-zinc-800/60">
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <p className="inline-flex items-center gap-2 text-xs font-semibold text-zinc-900 dark:text-zinc-100">
                      <span aria-hidden className="h-2 w-2 rounded-full" style={{ backgroundColor: entry.tag.color ?? '#71717a' }} />
                      {entry.tag.name}
                    </p>
                    <p className="pb-num text-[11px] tabular-nums text-zinc-500">
                      {'Busiest day ' + readableDay(entry.surgeDay) + ' · ' + number.format(entry.surgePosts) + ' posts'}
                    </p>
                  </div>

                  {firstName ? (
                    <p className="mt-1.5 text-[11px] text-zinc-600 dark:text-zinc-400">
                      <span className="font-medium text-zinc-900 dark:text-zinc-100">{firstName}</span>
                      {' posted on it earliest that day.'}
                    </p>
                  ) : null}

                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {followers.map((participant) => {
                      const candidate = race.candidates.find((c) => c.companyId === participant.companyId);
                      const row = rowFor(analytics.engagementTotal, participant.companyId);
                      const name = candidate?.name ?? row?.company.name ?? 'Candidate';
                      return (
                        <span
                          key={participant.companyId}
                          className="inline-flex items-center gap-1.5 rounded-full bg-emerald-50 px-2 py-0.5 text-[11px] text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300"
                          title={participant.before + ' posts before → ' + participant.after + ' after'}
                        >
                          {name}
                          <span className="pb-num tabular-nums opacity-70">
                            {participant.before + '→' + participant.after}
                          </span>
                        </span>
                      );
                    })}
                    {followers.length === 0 ? (
                      <span className="text-[11px] text-zinc-500">
                        No other candidate posted more on this topic afterwards.
                      </span>
                    ) : null}
                    {steady.length > 0 ? (
                      <span className="text-[11px] text-zinc-400">
                        {'· ' + steady.length + ' did not increase'}
                      </span>
                    ) : null}
                  </div>
                </div>
              );
            })}
          </CardBody>
          <div className="border-t border-zinc-200 px-4 py-2.5 dark:border-zinc-800">
            <p className="text-[11px] leading-relaxed text-zinc-500">
              These are counts and timestamps, not causation: posting earliest does not mean a
              candidate set the agenda. Whether a later post agrees or pushes back is not measured —
              the pipeline classifies subject matter, not stance.
            </p>
          </div>
        </Card>
      ) : null}

      <Card>
        <CardHeader>
          <div>
            <CardTitle>What each candidate posts about</CardTitle>
            <CardDescription>
              Each candidate&rsquo;s most-posted topics, as a share of their own classified posts.
              Read the share, not the count: candidates post at very different volumes.
            </CardDescription>
          </div>
        </CardHeader>
        <CardBody className="space-y-4">
          {topics.candidates.map((entry) => {
            const candidate = race.candidates.find((c) => c.companyId === entry.companyId);
            const row = rowFor(analytics.engagementTotal, entry.companyId);
            const name = candidate?.name ?? row?.company.name ?? 'Candidate';
            return (
              <div key={entry.companyId} className="flex items-start gap-3">
                <CandidateMark candidate={candidate} row={row} size="sm" />
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <p className="text-xs font-semibold text-zinc-900 dark:text-zinc-100">{name}</p>
                    <p className="pb-num text-[11px] tabular-nums text-zinc-500">
                      {number.format(entry.taggedPosts) + ' classified posts'}
                    </p>
                  </div>
                  <div className="mt-1.5 flex flex-wrap gap-1.5">
                    {entry.topics.map((topic) => (
                      <span
                        key={topic.id}
                        className="inline-flex items-center gap-1.5 rounded-full border border-zinc-200 px-2 py-0.5 text-[11px] text-zinc-700 dark:border-zinc-800 dark:text-zinc-300"
                        title={number.format(topic.posts) + ' posts'}
                      >
                        <span
                          aria-hidden
                          className="h-1.5 w-1.5 rounded-full"
                          style={{ backgroundColor: topic.color ?? '#71717a' }}
                        />
                        {topic.name}
                        <span className="pb-num tabular-nums text-zinc-400">
                          {Math.round(topic.share * 100) + '%'}
                        </span>
                      </span>
                    ))}
                  </div>
                </div>
              </div>
            );
          })}
        </CardBody>
      </Card>
    </div>
  );
}

function CandidateProfiles({ race, analytics }: {
  race: ElectionRaceDetail;
  analytics: ElectionRaceAnalytics;
}) {
  const ordered = analytics.engagementTotal.length
    ? analytics.engagementTotal
      .map((row) => race.candidates.find((candidate) => candidate.companyId === row.company.id))
      .filter((candidate): candidate is ElectionCandidateRecord => Boolean(candidate))
    : race.candidates;
  const [candidateId, setCandidateId] = React.useState(ordered[0]?.id ?? '');
  const candidate = ordered.find((item) => item.id === candidateId) ?? ordered[0];
  if (!candidate) {
    return <Card><CardBody className="py-10 text-center text-xs text-zinc-500">Add a candidate to begin tracking the race.</CardBody></Card>;
  }
  const engagement = rowFor(analytics.engagementTotal, candidate.companyId);
  const audience = rowFor(analytics.audience, candidate.companyId);
  const audienceChange = rowFor(analytics.audienceNetChange, candidate.companyId);
  const share = rowFor(analytics.shareOfEngagement, candidate.companyId);
  const posts = rowFor(analytics.posts, candidate.companyId);
  const views = rowFor(analytics.views, candidate.companyId);
  const platformTotal = engagement?.available ? engagement.value : 0;
  const platforms = PLATFORM_ORDER.filter((platform) => (engagement?.breakdown?.[platform] ?? 0) > 0);
  const selectedCompany = new Set([candidate.companyId]);
  const candidatePosts = analytics.topPosts.filter((post) => post.company.id === candidate.companyId);

  return (
    <div className="grid gap-4 xl:grid-cols-[17rem_minmax(0,1fr)]">
      <Card className="self-start xl:sticky xl:top-20">
        <CardHeader><CardTitle>Candidate field</CardTitle><Badge tone="neutral">{ordered.length}</Badge></CardHeader>
        <div className="max-h-[48rem] divide-y divide-zinc-100 overflow-y-auto dark:divide-zinc-800/60">
          {ordered.map((item) => {
            const row = rowFor(analytics.engagementTotal, item.companyId);
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => setCandidateId(item.id)}
                className={cn('flex w-full items-center gap-2.5 px-3 py-3 text-left transition-colors', item.id === candidate.id ? 'bg-accent-50 dark:bg-accent-950/20' : 'hover:bg-zinc-50 dark:hover:bg-zinc-800/40')}
              >
                <CandidateMark candidate={item} size="sm" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-xs font-semibold">{item.name}</span>
                  <span className="mt-0.5 block truncate text-[10px] text-zinc-500">{[item.party, item.currentRole].filter(Boolean).join(' · ') || 'Candidate'}</span>
                </span>
                <span className="pb-num text-xs font-semibold">{row?.available ? compactNumber(row.value) : '—'}</span>
              </button>
            );
          })}
        </div>
      </Card>

      <div className="min-w-0 space-y-4">
        <Card>
          <CardBody className="flex flex-wrap items-start justify-between gap-5">
            <div className="flex items-center gap-3">
              <CandidateMark candidate={candidate} size="lg" />
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <h3 className="text-xl font-semibold tracking-tight">{candidate.name}</h3>
                  <Badge tone="outline">{candidate.status}</Badge>
                </div>
                <p className="mt-1 text-xs text-zinc-500">{[candidate.party, candidate.currentRole, candidate.incumbent ? 'Incumbent in this race' : null].filter(Boolean).join(' · ') || 'Candidate'}</p>
              </div>
            </div>
            <div className="text-right">
              <p className="text-[10px] font-semibold uppercase tracking-[0.1em] text-zinc-500">Engagement rank</p>
              <p className="pb-num mt-1 text-4xl font-semibold tracking-tight">{engagement?.rank ? '#' + engagement.rank : '—'}</p>
            </div>
          </CardBody>
        </Card>

        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {[
            { label: 'Total audience', row: audience, value: audience?.available ? compactNumber(audience.value) : '—' },
            { label: 'Audience added', row: audienceChange, value: audienceChange?.available ? (audienceChange.value > 0 ? '+' : '') + compactNumber(audienceChange.value) : '—' },
            { label: 'Engagement', row: engagement, value: engagement?.available ? compactNumber(engagement.value) : '—' },
            { label: 'Share of engagement', row: share, value: share?.available ? (share.value * 100).toFixed(1) + '%' : '—' },
            { label: 'Posts published', row: posts, value: posts?.available ? number.format(posts.value) : '—' },
            { label: 'Video views', row: views, value: views?.available ? compactNumber(views.value) : '—' },
          ].map((item) => (
            <Card key={item.label}>
              <CardBody>
                <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-zinc-500">{item.label}</p>
                <strong className="pb-num mt-2 block text-2xl">{item.value}</strong>
                <p className="mt-1 text-[10px]"><MetricDelta row={item.row} /></p>
              </CardBody>
            </Card>
          ))}
        </div>

        <div className="grid gap-4 xl:grid-cols-2">
          <TrendChart
            title={candidate.name + ' engagement trend'}
            description="How this candidate's measured interactions changed through the selected window."
            result={analytics.engagementSeries}
            race={race}
            companyIds={selectedCompany}
            emptyText="Engagement trends appear after posts are collected."
          />
          <TrendChart
            title={candidate.name + ' publishing pace'}
            description="Collected posts over time for this candidate's public accounts."
            result={analytics.postSeries}
            race={race}
            companyIds={selectedCompany}
            mode="bar"
            emptyText="Publishing activity appears after posts are collected."
          />
        </div>

        <Card>
          <CardHeader>
            <div>
              <CardTitle>Where engagement is coming from</CardTitle>
              <CardDescription className="mt-1">Platform contribution to this candidate&apos;s measurable engagement.</CardDescription>
            </div>
          </CardHeader>
          <CardBody className="space-y-3">
            {platforms.length ? platforms.map((platform) => {
              const value = engagement?.breakdown?.[platform] ?? 0;
              const percentage = platformTotal > 0 ? (value / platformTotal) * 100 : 0;
              return (
                <div key={platform} className="grid grid-cols-[7rem_minmax(0,1fr)_5.5rem] items-center gap-3">
                  <span className="inline-flex items-center gap-2 text-xs font-medium"><PlatformIcon platform={platform} className="h-4 w-4" />{PLATFORM_LABELS[platform]}</span>
                  <div className="h-2 overflow-hidden rounded-full bg-zinc-100 dark:bg-zinc-800"><div className="h-full rounded-full" style={{ width: percentage + '%', backgroundColor: PLATFORM_COLORS[platform] }} /></div>
                  <span className="pb-num text-right text-[11px] text-zinc-500" title={number.format(value)}>{compactNumber(value)} · {percentage.toFixed(0)}%</span>
                </div>
              );
            }) : <p className="py-6 text-center text-xs text-zinc-500">Platform mix appears after posts are collected.</p>}
          </CardBody>
        </Card>

        <TopPostsPanel
          posts={candidatePosts}
          title={candidate.name + ' top content'}
          scopeLabel={candidate.name}
          landscapeId={race.landscapeId}
          href="/posts"
          perPlatform={3}
        />
      </div>
    </div>
  );
}

function RankedMetric({ title, description, rows, race, kind = 'number' }: {
  title: string;
  description: string;
  rows: MetricRow[];
  race: ElectionRaceDetail;
  kind?: 'number' | 'percent' | 'signed';
}) {
  const measured = rows.filter((row) => row.available);
  const denominator = Math.max(1, ...measured.map((row) => Math.abs(row.value)));
  const display = (value: number) => kind === 'percent' ? (value * 100).toFixed(1) + '%' : kind === 'signed' ? (value > 0 ? '+' : '') + compactNumber(value) : compactNumber(value);
  return (
    <Card>
      <CardHeader><div><CardTitle>{title}</CardTitle><CardDescription className="mt-1">{description}</CardDescription></div></CardHeader>
      <CardBody className="space-y-3">
        {measured.length ? measured.map((row) => {
          const candidate = candidateFor(row, race);
          return (
            <div key={row.company.id} className="grid grid-cols-[minmax(8rem,0.8fr)_minmax(8rem,1.2fr)_4.5rem] items-center gap-3">
              <span className="flex min-w-0 items-center gap-2"><CandidateMark candidate={candidate} row={row} size="sm" /><span className="truncate text-xs font-semibold">{row.company.name}</span></span>
              <div className="h-2 overflow-hidden rounded-full bg-zinc-100 dark:bg-zinc-800"><div className="h-full rounded-full" style={{ width: Math.max(2, (Math.abs(row.value) / denominator) * 100) + '%', backgroundColor: colorFor(candidate, row.company.color), opacity: row.complete === false ? 0.55 : 1 }} /></div>
              <span className={cn('pb-num text-right text-xs font-semibold', kind === 'signed' && row.value > 0 && 'text-emerald-700 dark:text-emerald-400', kind === 'signed' && row.value < 0 && 'text-red-700 dark:text-red-400')} title={number.format(row.value)}>{display(row.value)}</span>
            </div>
          );
        }) : <p className="py-5 text-center text-xs text-zinc-500">Not enough data yet.</p>}
      </CardBody>
    </Card>
  );
}

function CompareView({ race, analytics }: { race: ElectionRaceDetail; analytics: ElectionRaceAnalytics }) {
  return (
    <div className="space-y-4">
      <div className="rounded-lg border border-blue-200 bg-blue-50 px-4 py-3 text-xs leading-5 text-blue-900 dark:border-blue-900/60 dark:bg-blue-950/25 dark:text-blue-300"><strong>Social performance is not polling.</strong> These comparisons measure the response to collected campaign content; they do not predict votes.</div>
      <div className="grid gap-4 xl:grid-cols-2">
        <RankedMetric title="Total engagement" description="Interactions earned across measured platforms." rows={analytics.engagementTotal} race={race} />
        <RankedMetric title="Share of engagement" description="Each candidate's portion of all measured race engagement." rows={analytics.shareOfEngagement} race={race} kind="percent" />
        <RankedMetric title="Combined audience" description="Latest follower stocks across measured campaign profiles." rows={analytics.audience} race={race} />
        <RankedMetric title="Audience change" description="Follower change where both endpoints were captured." rows={analytics.audienceNetChange} race={race} kind="signed" />
        <RankedMetric title="Publishing volume" description="Collected campaign posts during the window." rows={analytics.posts} race={race} />
        <RankedMetric title="Video views" description="Captured platform view totals where supplied." rows={analytics.views} race={race} />
      </div>
    </div>
  );
}

export function ElectionRaceDashboard({ race, analytics }: { race: ElectionRaceDetail; analytics: ElectionRaceAnalytics }) {
  const [tab, setTab] = React.useState('overview');
  return (
    <section className="space-y-4">
      <div className="rounded-xl border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-950">
        <div className="flex flex-wrap items-center justify-between gap-3 px-4 pt-3">
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-[0.15em] text-accent-600">Live campaign intelligence</p>
            <p className="mt-1 text-xs text-zinc-500">{readableDay(analytics.range.start)}–{readableDay(analytics.range.end)} · {periodLabel(analytics)}</p>
          </div>
          <Badge tone="positive">Code-computed data</Badge>
        </div>
        <Tabs items={METRIC_TABS} value={tab} onChange={setTab} label="Election analytics views" className="mt-3 overflow-x-auto px-2" />
      </div>
      <TabPanel id="election-overview" active={tab === 'overview'}><OverviewView race={race} analytics={analytics} /></TabPanel>
      <TabPanel id="election-topics" active={tab === 'topics'}><TopicsView race={race} analytics={analytics} /></TabPanel>
      <TabPanel id="election-content" active={tab === 'content'}><TopPostsPanel posts={analytics.topPosts} title="Content shaping the race" scopeLabel={race.name} landscapeId={race.landscapeId} href="/posts" perPlatform={3} /></TabPanel>
      <TabPanel id="election-candidates" active={tab === 'candidates'}><CandidateProfiles race={race} analytics={analytics} /></TabPanel>
      <TabPanel id="election-compare" active={tab === 'compare'}><CompareView race={race} analytics={analytics} /></TabPanel>
    </section>
  );
}
