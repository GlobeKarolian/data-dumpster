'use client';

import * as React from 'react';
import {
  Activity,
  ArrowUpRight,
  BarChart3,
  Eye,
  Gauge,
  GitCompareArrows,
  Newspaper,
  Play,
  TrendingDown,
  TrendingUp,
  Users,
  Zap,
} from 'lucide-react';
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip as ChartTooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { Badge, PlatformBadge } from '@/components/ui/badge';
import { Card, CardBody, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabPanel } from '@/components/ui/tabs';
import { PlatformIcon } from '@/components/ui/platform-icon';
import { cn } from '@/lib/utils';
import type { Platform } from '@/lib/types';

type Candidate = {
  id: string;
  name: string;
  initials: string;
  role: string;
  status: string;
  color: string;
  score: number;
  scoreDelta: number;
  followers: string;
  followerGrowth: number;
  engagement: string;
  engagementDelta: number;
  share: number;
  breakouts: number;
  platforms: Partial<Record<Platform, number>>;
  factors: { label: string; value: number; note: string }[];
};

const CANDIDATES: Candidate[] = [
  {
    id: 'maya-torres',
    name: 'Maya Torres',
    initials: 'MT',
    role: 'Governor · Southwest',
    status: 'Watched prospect',
    color: '#C8102E',
    score: 82,
    scoreDelta: 7,
    followers: '18.4M',
    followerGrowth: 4.8,
    engagement: '1.92M',
    engagementDelta: 18.6,
    share: 24.3,
    breakouts: 9,
    platforms: { tiktok: 31, instagram: 27, youtube: 18, facebook: 13, twitter: 11 },
    factors: [
      { label: 'Audience growth', value: 91, note: '+4.8% over 28 days' },
      { label: 'Engagement strength', value: 86, note: '1.92M engagements' },
      { label: 'Cross-platform reach', value: 78, note: '5 active platforms' },
      { label: 'Breakout consistency', value: 72, note: '9 breakout posts' },
    ],
  },
  {
    id: 'liam-brooks',
    name: 'Liam Brooks',
    initials: 'LB',
    role: 'U.S. Senator · Midwest',
    status: 'Watched prospect',
    color: '#2563EB',
    score: 78,
    scoreDelta: 2,
    followers: '12.7M',
    followerGrowth: 2.1,
    engagement: '1.61M',
    engagementDelta: 7.3,
    share: 20.4,
    breakouts: 6,
    platforms: { youtube: 28, facebook: 24, twitter: 22, instagram: 18, tiktok: 8 },
    factors: [
      { label: 'Audience growth', value: 74, note: '+2.1% over 28 days' },
      { label: 'Engagement strength', value: 82, note: '1.61M engagements' },
      { label: 'Cross-platform reach', value: 85, note: '5 active platforms' },
      { label: 'Breakout consistency', value: 68, note: '6 breakout posts' },
    ],
  },
  {
    id: 'dana-kim',
    name: 'Dana Kim',
    initials: 'DK',
    role: 'Governor · Pacific',
    status: 'Watched prospect',
    color: '#7C3AED',
    score: 74,
    scoreDelta: 9,
    followers: '8.9M',
    followerGrowth: 6.2,
    engagement: '1.38M',
    engagementDelta: 31.4,
    share: 17.5,
    breakouts: 11,
    platforms: { instagram: 34, tiktok: 29, youtube: 16, threads: 12, facebook: 9 },
    factors: [
      { label: 'Audience growth', value: 96, note: '+6.2% over 28 days' },
      { label: 'Engagement strength', value: 77, note: '1.38M engagements' },
      { label: 'Cross-platform reach', value: 67, note: '5 active platforms' },
      { label: 'Breakout consistency', value: 84, note: '11 breakout posts' },
    ],
  },
  {
    id: 'marcus-reed',
    name: 'Marcus Reed',
    initials: 'MR',
    role: 'Former cabinet secretary',
    status: 'Watched prospect',
    color: '#0891B2',
    score: 66,
    scoreDelta: -3,
    followers: '6.2M',
    followerGrowth: 0.7,
    engagement: '982K',
    engagementDelta: -8.2,
    share: 12.4,
    breakouts: 4,
    platforms: { twitter: 32, youtube: 25, linkedin: 18, facebook: 15, instagram: 10 },
    factors: [
      { label: 'Audience growth', value: 59, note: '+0.7% over 28 days' },
      { label: 'Engagement strength', value: 69, note: '982K engagements' },
      { label: 'Cross-platform reach', value: 72, note: '5 active platforms' },
      { label: 'Breakout consistency', value: 55, note: '4 breakout posts' },
    ],
  },
  {
    id: 'elena-ward',
    name: 'Elena Ward',
    initials: 'EW',
    role: 'U.S. Senator · Northeast',
    status: 'Watched prospect',
    color: '#D97706',
    score: 61,
    scoreDelta: 4,
    followers: '4.8M',
    followerGrowth: 3.3,
    engagement: '746K',
    engagementDelta: 12.1,
    share: 9.4,
    breakouts: 5,
    platforms: { instagram: 30, facebook: 23, threads: 21, tiktok: 15, twitter: 11 },
    factors: [
      { label: 'Audience growth', value: 82, note: '+3.3% over 28 days' },
      { label: 'Engagement strength', value: 62, note: '746K engagements' },
      { label: 'Cross-platform reach', value: 65, note: '5 active platforms' },
      { label: 'Breakout consistency', value: 58, note: '5 breakout posts' },
    ],
  },
  {
    id: 'thomas-vale',
    name: 'Thomas Vale',
    initials: 'TV',
    role: 'Governor · Southeast',
    status: 'Watched prospect',
    color: '#059669',
    score: 54,
    scoreDelta: -5,
    followers: '3.9M',
    followerGrowth: -0.4,
    engagement: '512K',
    engagementDelta: -14.7,
    share: 6.5,
    breakouts: 2,
    platforms: { facebook: 35, youtube: 26, instagram: 18, twitter: 13, tiktok: 8 },
    factors: [
      { label: 'Audience growth', value: 44, note: '-0.4% over 28 days' },
      { label: 'Engagement strength', value: 55, note: '512K engagements' },
      { label: 'Cross-platform reach', value: 61, note: '5 active platforms' },
      { label: 'Breakout consistency', value: 38, note: '2 breakout posts' },
    ],
  },
];

const MOMENTUM = [
  { week: 'Jun 8', torres: 61, brooks: 68, kim: 42, reed: 64 },
  { week: 'Jun 15', torres: 64, brooks: 70, kim: 46, reed: 67 },
  { week: 'Jun 22', torres: 67, brooks: 69, kim: 51, reed: 68 },
  { week: 'Jun 29', torres: 69, brooks: 72, kim: 54, reed: 70 },
  { week: 'Jul 6', torres: 71, brooks: 73, kim: 60, reed: 69 },
  { week: 'Jul 13', torres: 75, brooks: 76, kim: 65, reed: 69 },
  { week: 'Jul 20', torres: 82, brooks: 78, kim: 74, reed: 66 },
];

const POSTS: {
  rank: number;
  candidate: string;
  platform: Platform;
  format: string;
  headline: string;
  engagement: string;
  views: string;
  breakout: string;
  color: string;
}[] = [
  { rank: 1, candidate: 'Dana Kim', platform: 'tiktok', format: 'Video · 0:42', headline: 'A direct answer on the cost of housing', engagement: '486K', views: '8.2M', breakout: '18.4×', color: '#7C3AED' },
  { rank: 2, candidate: 'Maya Torres', platform: 'instagram', format: 'Reel · 1:08', headline: 'The moment a town hall changed direction', engagement: '411K', views: '5.9M', breakout: '12.7×', color: '#C8102E' },
  { rank: 3, candidate: 'Liam Brooks', platform: 'youtube', format: 'Video · 6:14', headline: 'A six-minute argument about American manufacturing', engagement: '328K', views: '3.1M', breakout: '9.1×', color: '#2563EB' },
  { rank: 4, candidate: 'Elena Ward', platform: 'threads', format: 'Text thread', headline: 'Ten numbers behind the childcare squeeze', engagement: '194K', views: '—', breakout: '7.8×', color: '#D97706' },
  { rank: 5, candidate: 'Marcus Reed', platform: 'twitter', format: 'Video · 2:21', headline: 'What the debate missed about foreign policy', engagement: '162K', views: '2.4M', breakout: '5.6×', color: '#0891B2' },
  { rank: 6, candidate: 'Thomas Vale', platform: 'facebook', format: 'Live · 18:03', headline: 'Questions from a small-business roundtable', engagement: '121K', views: '1.2M', breakout: '4.2×', color: '#059669' },
];

const PLATFORM_ORDER: Platform[] = ['tiktok', 'instagram', 'youtube', 'facebook', 'twitter', 'threads', 'linkedin'];

function Delta({ value, suffix = '' }: { value: number; suffix?: string }) {
  const positive = value >= 0;
  const Icon = positive ? TrendingUp : TrendingDown;
  return (
    <span className={cn('pb-num inline-flex items-center gap-1 text-xs font-medium', positive ? 'text-emerald-700 dark:text-emerald-400' : 'text-red-700 dark:text-red-400')}>
      <Icon className="h-3 w-3" aria-hidden />
      {positive ? '+' : ''}{value.toFixed(1)}{suffix}
    </span>
  );
}

function CandidateMark({ candidate, size = 'md' }: { candidate: Candidate; size?: 'sm' | 'md' | 'lg' }) {
  return (
    <span
      aria-hidden
      className={cn(
        'grid shrink-0 place-items-center rounded-full font-semibold text-white',
        size === 'sm' && 'h-7 w-7 text-[10px]',
        size === 'md' && 'h-9 w-9 text-xs',
        size === 'lg' && 'h-14 w-14 text-base',
      )}
      style={{ backgroundColor: candidate.color }}
    >
      {candidate.initials}
    </span>
  );
}

function PreviewBanner() {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 dark:border-amber-900/60 dark:bg-amber-950/20">
      <div>
        <p className="text-xs font-semibold text-amber-900 dark:text-amber-200">Concept preview · sample data</p>
        <p className="mt-0.5 text-[11px] leading-relaxed text-amber-800/80 dark:text-amber-300/75">
          Every candidate, account and figure on this page is fictional. This preview makes no claim about who will run in 2028.
        </p>
      </div>
      <Badge tone="warning">Not connected to collection</Badge>
    </div>
  );
}

function OverviewView() {
  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {[
          { label: 'Watched prospects', value: '18', note: '6 shown in this preview', icon: Users },
          { label: 'Engagement · 28 days', value: '7.89M', note: '+12.4% vs prior period', icon: Activity },
          { label: 'Audience added', value: '+1.42M', note: 'Across measured platforms', icon: TrendingUp },
          { label: 'Breakout posts', value: '37', note: 'At least 3× candidate median', icon: Zap },
        ].map((item) => {
          const Icon = item.icon;
          return (
            <Card key={item.label}>
              <CardBody className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-[10px] font-semibold uppercase tracking-[0.1em] text-zinc-500">{item.label}</p>
                  <p className="pb-num mt-2 text-2xl font-semibold tracking-tight text-zinc-950 dark:text-zinc-50">{item.value}</p>
                  <p className="mt-1 text-[11px] text-zinc-500">{item.note}</p>
                </div>
                <Icon className="h-4 w-4 text-zinc-400" strokeWidth={1.75} aria-hidden />
              </CardBody>
            </Card>
          );
        })}
      </div>

      <div className="grid gap-4 xl:grid-cols-[1.05fr_1.45fr]">
        <Card>
          <CardHeader>
            <div>
              <CardTitle>Social viability ranking</CardTitle>
              <CardDescription className="mt-1">Transparent composite of growth, engagement, reach and breakout consistency.</CardDescription>
            </div>
            <Gauge className="h-4 w-4 text-zinc-400" aria-hidden />
          </CardHeader>
          <div className="divide-y divide-zinc-100 dark:divide-zinc-800/60">
            {CANDIDATES.map((candidate, index) => (
              <div key={candidate.id} className="grid grid-cols-[1.25rem_minmax(0,1fr)_auto] items-center gap-3 px-4 py-3">
                <span className="pb-num text-center text-[11px] text-zinc-400">{index + 1}</span>
                <div className="flex min-w-0 items-center gap-2.5">
                  <CandidateMark candidate={candidate} size="sm" />
                  <div className="min-w-0">
                    <p className="truncate text-xs font-semibold text-zinc-900 dark:text-zinc-100">{candidate.name}</p>
                    <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-zinc-100 dark:bg-zinc-800">
                      <div className="h-full rounded-full" style={{ width: candidate.score + '%', backgroundColor: candidate.color }} />
                    </div>
                  </div>
                </div>
                <div className="text-right">
                  <p className="pb-num text-base font-semibold text-zinc-950 dark:text-zinc-50">{candidate.score}</p>
                  <span className={cn('pb-num text-[10px] font-medium', candidate.scoreDelta >= 0 ? 'text-emerald-600' : 'text-red-600')}>
                    {candidate.scoreDelta >= 0 ? '+' : ''}{candidate.scoreDelta} this week
                  </span>
                </div>
              </div>
            ))}
          </div>
        </Card>

        <Card>
          <CardHeader>
            <div>
              <CardTitle>Momentum over time</CardTitle>
              <CardDescription className="mt-1">Eight-week social viability trend for the four leading prospects.</CardDescription>
            </div>
            <Badge tone="outline">Weekly</Badge>
          </CardHeader>
          <CardBody>
            <div className="mb-3 flex flex-wrap gap-x-4 gap-y-2">
              {CANDIDATES.slice(0, 4).map((candidate) => (
                <span key={candidate.id} className="inline-flex items-center gap-1.5 text-[11px] text-zinc-600 dark:text-zinc-400">
                  <span className="h-2 w-2 rounded-full" style={{ backgroundColor: candidate.color }} aria-hidden />
                  {candidate.name}
                </span>
              ))}
            </div>
            <div className="h-[300px] min-w-0">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={MOMENTUM} margin={{ top: 8, right: 8, bottom: 0, left: -18 }}>
                  <CartesianGrid stroke="var(--pb-grid)" vertical={false} />
                  <XAxis dataKey="week" tick={{ fill: 'var(--pb-label)', fontSize: 10 }} tickLine={false} axisLine={false} />
                  <YAxis domain={[35, 90]} tick={{ fill: 'var(--pb-label)', fontSize: 10 }} tickLine={false} axisLine={false} />
                  <ChartTooltip
                    contentStyle={{ borderColor: 'var(--pb-grid)', background: 'var(--pb-surface)', borderRadius: 6, fontSize: 11 }}
                    labelStyle={{ color: 'var(--pb-label)', fontWeight: 600 }}
                  />
                  <Line type="monotone" dataKey="torres" name="Maya Torres" stroke="#C8102E" strokeWidth={2.25} dot={false} activeDot={{ r: 4 }} />
                  <Line type="monotone" dataKey="brooks" name="Liam Brooks" stroke="#2563EB" strokeWidth={2} dot={false} activeDot={{ r: 4 }} />
                  <Line type="monotone" dataKey="kim" name="Dana Kim" stroke="#7C3AED" strokeWidth={2} dot={false} activeDot={{ r: 4 }} />
                  <Line type="monotone" dataKey="reed" name="Marcus Reed" stroke="#0891B2" strokeWidth={2} dot={false} activeDot={{ r: 4 }} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </CardBody>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <div>
            <CardTitle>Share of engagement</CardTitle>
            <CardDescription className="mt-1">Who captured the field’s measurable engagement during the selected window.</CardDescription>
          </div>
          <BarChart3 className="h-4 w-4 text-zinc-400" aria-hidden />
        </CardHeader>
        <CardBody className="space-y-3">
          <div className="flex h-8 w-full overflow-hidden rounded-md">
            {CANDIDATES.map((candidate) => (
              <div
                key={candidate.id}
                className="grid min-w-0 place-items-center border-r border-white/50 text-[10px] font-semibold text-white last:border-r-0"
                style={{ width: candidate.share + '%', backgroundColor: candidate.color }}
                title={candidate.name + ': ' + candidate.share + '%'}
              >
                {candidate.share >= 12 ? candidate.share + '%' : ''}
              </div>
            ))}
          </div>
          <div className="flex flex-wrap gap-x-5 gap-y-2">
            {CANDIDATES.map((candidate) => (
              <span key={candidate.id} className="inline-flex items-center gap-1.5 text-[11px] text-zinc-600 dark:text-zinc-400">
                <span className="h-2 w-2 rounded-full" style={{ backgroundColor: candidate.color }} aria-hidden />
                {candidate.name} <span className="pb-num text-zinc-400">{candidate.share}%</span>
              </span>
            ))}
          </div>
        </CardBody>
      </Card>
    </div>
  );
}

function CandidateView() {
  const [candidateId, setCandidateId] = React.useState(CANDIDATES[0].id);
  const candidate = CANDIDATES.find((item) => item.id === candidateId) ?? CANDIDATES[0];

  return (
    <div className="grid gap-4 xl:grid-cols-[17rem_minmax(0,1fr)]">
      <Card className="self-start">
        <CardHeader>
          <CardTitle>Candidate watchlist</CardTitle>
          <Badge tone="neutral">{CANDIDATES.length} shown</Badge>
        </CardHeader>
        <div className="divide-y divide-zinc-100 dark:divide-zinc-800/60">
          {CANDIDATES.map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() => setCandidateId(item.id)}
              className={cn(
                'flex w-full items-center gap-2.5 px-3 py-3 text-left transition-colors',
                item.id === candidate.id ? 'bg-accent-50 dark:bg-accent-950/20' : 'hover:bg-zinc-50 dark:hover:bg-zinc-800/40',
              )}
            >
              <CandidateMark candidate={item} size="sm" />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-xs font-semibold text-zinc-900 dark:text-zinc-100">{item.name}</span>
                <span className="mt-0.5 block truncate text-[10px] text-zinc-500">{item.role}</span>
              </span>
              <span className="pb-num text-sm font-semibold text-zinc-800 dark:text-zinc-200">{item.score}</span>
            </button>
          ))}
        </div>
      </Card>

      <div className="space-y-4">
        <Card>
          <CardBody className="flex flex-wrap items-start justify-between gap-5">
            <div className="flex items-center gap-3">
              <CandidateMark candidate={candidate} size="lg" />
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <h2 className="text-xl font-semibold tracking-tight text-zinc-950 dark:text-zinc-50">{candidate.name}</h2>
                  <Badge tone="outline">{candidate.status}</Badge>
                </div>
                <p className="mt-1 text-xs text-zinc-500">{candidate.role}</p>
              </div>
            </div>
            <div className="text-right">
              <p className="text-[10px] font-semibold uppercase tracking-[0.1em] text-zinc-500">Social viability</p>
              <div className="mt-1 flex items-end justify-end gap-2">
                <span className="pb-num text-4xl font-semibold tracking-tight text-zinc-950 dark:text-zinc-50">{candidate.score}</span>
                <span className="pb-num mb-1 text-sm font-medium text-emerald-600">{candidate.scoreDelta >= 0 ? '+' : ''}{candidate.scoreDelta}</span>
              </div>
            </div>
          </CardBody>
        </Card>

        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {[
            { label: 'Total audience', value: candidate.followers, detail: candidate.followerGrowth, suffix: '%' },
            { label: 'Engagement', value: candidate.engagement, detail: candidate.engagementDelta, suffix: '%' },
            { label: 'Share of engagement', value: candidate.share.toFixed(1) + '%', detail: 2.8, suffix: ' pts' },
            { label: 'Breakout posts', value: String(candidate.breakouts), detail: 3, suffix: ' vs prior' },
          ].map((item) => (
            <Card key={item.label}>
              <CardBody>
                <p className="text-[10px] font-semibold uppercase tracking-[0.1em] text-zinc-500">{item.label}</p>
                <p className="pb-num mt-2 text-2xl font-semibold tracking-tight text-zinc-950 dark:text-zinc-50">{item.value}</p>
                <div className="mt-1"><Delta value={item.detail} suffix={item.suffix} /></div>
              </CardBody>
            </Card>
          ))}
        </div>

        <div className="grid gap-4 lg:grid-cols-2">
          <Card>
            <CardHeader>
              <div>
                <CardTitle>What drives the score</CardTitle>
                <CardDescription className="mt-1">Every factor remains visible and independently inspectable.</CardDescription>
              </div>
            </CardHeader>
            <CardBody className="space-y-4">
              {candidate.factors.map((factor) => (
                <div key={factor.label}>
                  <div className="mb-1.5 flex items-center justify-between gap-3">
                    <span className="text-xs font-medium text-zinc-700 dark:text-zinc-300">{factor.label}</span>
                    <span className="pb-num text-[11px] text-zinc-500">{factor.value} · {factor.note}</span>
                  </div>
                  <div className="h-2 overflow-hidden rounded-full bg-zinc-100 dark:bg-zinc-800">
                    <div className="h-full rounded-full" style={{ width: factor.value + '%', backgroundColor: candidate.color }} />
                  </div>
                </div>
              ))}
            </CardBody>
          </Card>

          <Card>
            <CardHeader>
              <div>
                <CardTitle>Where the engagement comes from</CardTitle>
                <CardDescription className="mt-1">Share of the candidate’s measurable engagement by platform.</CardDescription>
              </div>
            </CardHeader>
            <CardBody className="space-y-3">
              {PLATFORM_ORDER.filter((platform) => candidate.platforms[platform]).map((platform) => {
                const value = candidate.platforms[platform] ?? 0;
                return (
                  <div key={platform} className="grid grid-cols-[6.5rem_minmax(0,1fr)_2.5rem] items-center gap-3">
                    <PlatformBadge platform={platform} />
                    <div className="h-2 overflow-hidden rounded-full bg-zinc-100 dark:bg-zinc-800">
                      <div className="h-full rounded-full bg-zinc-700 dark:bg-zinc-300" style={{ width: value + '%' }} />
                    </div>
                    <span className="pb-num text-right text-[11px] text-zinc-500">{value}%</span>
                  </div>
                );
              })}
            </CardBody>
          </Card>
        </div>

        <Card>
          <CardHeader>
            <div>
              <CardTitle>Topics creating momentum</CardTitle>
              <CardDescription className="mt-1">Themes in high-performing posts, not a claim about policy position or sentiment.</CardDescription>
            </div>
          </CardHeader>
          <CardBody className="flex flex-wrap gap-2">
            {['Cost of living', 'Housing', 'Healthcare', 'Local visits', 'Short-form video', 'Personal biography'].map((topic, index) => (
              <span
                key={topic}
                className="rounded-md border border-zinc-200 px-3 py-2 text-xs text-zinc-700 dark:border-zinc-700 dark:text-zinc-300"
                style={{ backgroundColor: index < 2 ? candidate.color + '10' : undefined }}
              >
                {topic}
              </span>
            ))}
          </CardBody>
        </Card>
      </div>
    </div>
  );
}

function CompareView() {
  const compared = CANDIDATES.slice(0, 4);
  const metrics = [
    { label: 'Social viability', key: 'score', max: 100, format: (candidate: Candidate) => String(candidate.score) },
    { label: 'Audience growth', key: 'growth', max: 7, format: (candidate: Candidate) => '+' + candidate.followerGrowth.toFixed(1) + '%' },
    { label: 'Engagement share', key: 'share', max: 28, format: (candidate: Candidate) => candidate.share.toFixed(1) + '%' },
    { label: 'Breakout posts', key: 'breakouts', max: 12, format: (candidate: Candidate) => String(candidate.breakouts) },
  ];

  const valueFor = (candidate: Candidate, key: string) => {
    if (key === 'score') return candidate.score;
    if (key === 'growth') return candidate.followerGrowth;
    if (key === 'share') return candidate.share;
    return candidate.breakouts;
  };

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <div>
            <CardTitle>Head-to-head</CardTitle>
            <CardDescription className="mt-1">Four prospects on the same measures and the same 28-day window.</CardDescription>
          </div>
          <Badge tone="outline">4 selected</Badge>
        </CardHeader>
        <div className="overflow-x-auto">
          <div className="min-w-[760px]">
            <div className="grid grid-cols-[11rem_repeat(4,minmax(8rem,1fr))] border-b border-zinc-200 dark:border-zinc-800">
              <div className="p-4" />
              {compared.map((candidate) => (
                <div key={candidate.id} className="border-l border-zinc-100 p-4 dark:border-zinc-800/60">
                  <div className="flex items-center gap-2">
                    <CandidateMark candidate={candidate} size="sm" />
                    <div>
                      <p className="text-xs font-semibold text-zinc-900 dark:text-zinc-100">{candidate.name}</p>
                      <p className="mt-0.5 text-[10px] text-zinc-500">{candidate.role.split('·')[0].trim()}</p>
                    </div>
                  </div>
                </div>
              ))}
            </div>
            {metrics.map((metric) => (
              <div key={metric.key} className="grid grid-cols-[11rem_repeat(4,minmax(8rem,1fr))] border-b border-zinc-100 last:border-b-0 dark:border-zinc-800/60">
                <div className="flex items-center px-4 py-5 text-xs font-medium text-zinc-700 dark:text-zinc-300">{metric.label}</div>
                {compared.map((candidate) => {
                  const value = valueFor(candidate, metric.key);
                  return (
                    <div key={candidate.id} className="border-l border-zinc-100 px-4 py-4 dark:border-zinc-800/60">
                      <p className="pb-num text-sm font-semibold text-zinc-950 dark:text-zinc-50">{metric.format(candidate)}</p>
                      <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-zinc-100 dark:bg-zinc-800">
                        <div className="h-full rounded-full" style={{ width: Math.max(0, Math.min(100, value / metric.max * 100)) + '%', backgroundColor: candidate.color }} />
                      </div>
                    </div>
                  );
                })}
              </div>
            ))}
          </div>
        </div>
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <div>
              <CardTitle>Fastest-rising prospect</CardTitle>
              <CardDescription className="mt-1">Momentum, not overall rank.</CardDescription>
            </div>
            <TrendingUp className="h-4 w-4 text-emerald-600" aria-hidden />
          </CardHeader>
          <CardBody className="flex items-center gap-4">
            <CandidateMark candidate={CANDIDATES[2]} size="lg" />
            <div className="min-w-0 flex-1">
              <p className="text-lg font-semibold text-zinc-950 dark:text-zinc-50">Dana Kim</p>
              <p className="mt-1 text-xs leading-relaxed text-zinc-500">Strongest 28-day audience growth and the most breakout posts in the watched field.</p>
            </div>
            <span className="pb-num text-2xl font-semibold text-emerald-600">+9</span>
          </CardBody>
        </Card>
        <Card>
          <CardHeader>
            <div>
              <CardTitle>Largest established footprint</CardTitle>
              <CardDescription className="mt-1">Scale, not current momentum.</CardDescription>
            </div>
            <Users className="h-4 w-4 text-zinc-400" aria-hidden />
          </CardHeader>
          <CardBody className="flex items-center gap-4">
            <CandidateMark candidate={CANDIDATES[0]} size="lg" />
            <div className="min-w-0 flex-1">
              <p className="text-lg font-semibold text-zinc-950 dark:text-zinc-50">Maya Torres</p>
              <p className="mt-1 text-xs leading-relaxed text-zinc-500">Largest measured audience and highest share of engagement across the field.</p>
            </div>
            <span className="pb-num text-2xl font-semibold text-zinc-950 dark:text-zinc-50">18.4M</span>
          </CardBody>
        </Card>
      </div>
    </div>
  );
}

function ContentView() {
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h2 className="text-base font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">Content shaping the field</h2>
          <p className="mt-1 max-w-2xl text-xs leading-relaxed text-zinc-500">Ranked by measurable engagement, with each post compared with that candidate’s typical performance on the same platform.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          {['All platforms', 'Video', 'Last 28 days'].map((filter, index) => (
            <span key={filter} className={cn('rounded-md border px-2.5 py-1.5 text-[11px]', index === 0 ? 'border-zinc-900 bg-zinc-900 text-white dark:border-zinc-100 dark:bg-zinc-100 dark:text-zinc-900' : 'border-zinc-200 text-zinc-600 dark:border-zinc-700 dark:text-zinc-400')}>
              {filter}
            </span>
          ))}
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-2 2xl:grid-cols-3">
        {POSTS.map((post) => (
          <Card key={post.rank} className="overflow-hidden">
            <div
              className="relative flex aspect-video items-end overflow-hidden p-4 text-white"
              style={{ background: 'linear-gradient(135deg, ' + post.color + ' 0%, #18181b 100%)' }}
            >
              <div className="absolute -right-10 -top-14 h-44 w-44 rounded-full border-[28px] border-white/10" aria-hidden />
              <div className="absolute bottom-[-4rem] left-[30%] h-40 w-40 rotate-45 border-[22px] border-white/10" aria-hidden />
              <span className="absolute left-3 top-3 rounded bg-black/35 px-2 py-1 text-[10px] font-semibold backdrop-blur-sm">#{post.rank}</span>
              {post.format.toLowerCase().includes('video') || post.format.toLowerCase().includes('reel') || post.format.toLowerCase().includes('live') ? (
                <span className="absolute inset-0 grid place-items-center">
                  <span className="grid h-11 w-11 place-items-center rounded-full bg-black/45 backdrop-blur-sm">
                    <Play className="ml-0.5 h-5 w-5 fill-white" aria-hidden />
                  </span>
                </span>
              ) : null}
              <div className="relative z-10 flex w-full items-center justify-between gap-3">
                <span className="inline-flex items-center gap-1.5 text-[11px] font-medium"><PlatformIcon platform={post.platform} className="h-3.5 w-3.5" />{post.format}</span>
                <Badge className="bg-white/15 text-white backdrop-blur-sm">{post.breakout} typical</Badge>
              </div>
            </div>
            <CardBody>
              <p className="text-xs font-semibold text-zinc-900 dark:text-zinc-100">{post.candidate}</p>
              <p className="mt-2 min-h-10 text-sm leading-snug text-zinc-700 dark:text-zinc-300">{post.headline}</p>
              <div className="mt-4 flex items-center justify-between gap-3 border-t border-zinc-100 pt-3 dark:border-zinc-800/60">
                <span className="inline-flex items-center gap-1.5 text-[11px] text-zinc-500"><Eye className="h-3 w-3" aria-hidden />{post.views} views</span>
                <span className="pb-num text-sm font-semibold text-zinc-950 dark:text-zinc-50">{post.engagement} engagement</span>
              </div>
            </CardBody>
          </Card>
        ))}
      </div>
    </div>
  );
}

export function ElectionTrackerPreview() {
  const [tab, setTab] = React.useState('overview');

  return (
    <div className="mx-auto max-w-[1600px] space-y-4">
      <PreviewBanner />

      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone="accent">Road to 2028</Badge>
            <span className="text-[11px] text-zinc-500">Presidential field · social performance</span>
          </div>
          <h2 className="mt-2 text-2xl font-semibold tracking-tight text-zinc-950 dark:text-zinc-50">Election Tracker</h2>
          <p className="mt-1 max-w-3xl text-sm leading-relaxed text-zinc-600 dark:text-zinc-400">
            Follow which prospective candidates are building durable attention, where it comes from and what content changes the shape of the field.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <span className="rounded-md border border-zinc-200 bg-white px-3 py-2 text-xs text-zinc-600 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-300">Last 28 days</span>
          <span className="rounded-md border border-zinc-200 bg-white px-3 py-2 text-xs text-zinc-600 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-300">All watched prospects</span>
        </div>
      </div>

      <Card>
        <Tabs
          label="Election tracker views"
          value={tab}
          onChange={setTab}
          className="overflow-x-auto px-2"
          items={[
            { id: 'overview', label: <span className="inline-flex items-center gap-1.5"><BarChart3 className="h-3.5 w-3.5" aria-hidden />State of the field</span> },
            { id: 'candidate', label: <span className="inline-flex items-center gap-1.5"><Users className="h-3.5 w-3.5" aria-hidden />Candidate profiles</span> },
            { id: 'compare', label: <span className="inline-flex items-center gap-1.5"><GitCompareArrows className="h-3.5 w-3.5" aria-hidden />Head-to-head</span> },
            { id: 'content', label: <span className="inline-flex items-center gap-1.5"><Newspaper className="h-3.5 w-3.5" aria-hidden />Top content</span> },
          ]}
        />
        <div className="p-4">
          <TabPanel id="election-overview" active={tab === 'overview'}><OverviewView /></TabPanel>
          <TabPanel id="election-candidate" active={tab === 'candidate'}><CandidateView /></TabPanel>
          <TabPanel id="election-compare" active={tab === 'compare'}><CompareView /></TabPanel>
          <TabPanel id="election-content" active={tab === 'content'}><ContentView /></TabPanel>
        </div>
      </Card>

      <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-zinc-200 bg-white px-4 py-3 text-[11px] text-zinc-500 dark:border-zinc-800 dark:bg-zinc-900/40">
        <span>Social performance measures attention and organizational reach. It is not polling, vote intention or an election forecast.</span>
        <span className="inline-flex items-center gap-1 font-medium text-zinc-700 dark:text-zinc-300">Methodology preview <ArrowUpRight className="h-3 w-3" aria-hidden /></span>
      </div>
    </div>
  );
}
