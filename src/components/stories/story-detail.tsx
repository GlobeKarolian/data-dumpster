'use client';

import * as React from 'react';
import { ExternalLink, X } from 'lucide-react';
import { PLATFORM_COLORS, PLATFORM_LABELS } from '@/lib/types';
import { cn, compactNumber } from '@/lib/utils';
import { formatDateTime, truncate } from '@/components/ui/format';
import { Badge } from '@/components/ui/badge';
import type { StoryDto, StoryPostDto } from './types';

/**
 * Cohesion, said out loud.
 *
 * The clusterer already knows how loosely a group holds together. Printing that
 * number without translating it is the same as hiding it, so each band gets the
 * sentence a reporter would need before quoting the grouping as a story.
 */
function cohesionBand(cohesion: number): { label: string; body: string; tone: 'positive' | 'warning' | 'critical' } {
  if (cohesion >= 0.55) {
    return {
      label: 'Tightly grouped',
      tone: 'positive',
      body: 'These posts share most of their distinctive vocabulary. Safe to treat as one story.',
    };
  }
  if (cohesion >= 0.35) {
    return {
      label: 'Moderately grouped',
      tone: 'warning',
      body: 'The posts overlap on several rare terms but not on all of them. Skim the timeline before quoting this as one story.',
    };
  }
  return {
    label: 'Loosely grouped',
    tone: 'critical',
    body: 'These posts were joined by a shared link or a thin overlap of terms. Treat this as a rough grouping, not a verified story.',
  };
}

function durationLabel(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return 'unknown';
  const minutes = Math.round(ms / 60000);
  if (minutes < 1) return 'under a minute';
  if (minutes < 60) return minutes + 'm';
  const hours = Math.round(minutes / 60);
  if (hours < 48) return hours + 'h';
  return Math.round(hours / 24) + 'd';
}

interface OutletGroup {
  id: string;
  name: string;
  posts: StoryPostDto[];
  firstAt: number;
  engagement: number;
}

/** Outlets ordered by when they arrived, because arrival order is the story. */
function groupByOutlet(posts: StoryPostDto[]): OutletGroup[] {
  const groups = new Map<string, OutletGroup>();
  for (const post of posts) {
    const at = new Date(post.postedAt).getTime();
    const existing = groups.get(post.companyId);
    if (existing) {
      existing.posts.push(post);
      existing.firstAt = Math.min(existing.firstAt, at);
      existing.engagement += post.engagementTotal;
    } else {
      groups.set(post.companyId, {
        id: post.companyId,
        name: post.companyName,
        posts: [post],
        firstAt: at,
        engagement: post.engagementTotal,
      });
    }
  }
  const out = [...groups.values()];
  for (const group of out) {
    group.posts.sort((a, b) => a.postedAt.localeCompare(b.postedAt));
  }
  return out.sort((a, b) => a.firstAt - b.firstAt);
}

function Figure({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <dt className="text-[10px] font-medium uppercase tracking-wider text-zinc-400 dark:text-zinc-500">
        {label}
      </dt>
      <dd className="pb-num mt-0.5 truncate text-sm font-semibold text-zinc-900 dark:text-zinc-100">
        {value}
      </dd>
    </div>
  );
}

export interface StoryDetailProps {
  story: StoryDto;
  onClose: () => void;
  className?: string;
}

/**
 * One story, read end to end.
 *
 * The cloud answers how big; this answers who got there first, who won it, and
 * whether the grouping deserves to be believed.
 */
export function StoryDetail({ story, onClose, className }: StoryDetailProps) {
  const outlets = React.useMemo(() => groupByOutlet(story.posts), [story.posts]);
  const band = cohesionBand(story.cohesion);

  const firstAt = new Date(story.firstPostedAt).getTime();
  const lastAt = new Date(story.lastPostedAt).getTime();
  const breaker = outlets[0] ?? null;
  const chaser = outlets[1] ?? null;
  const lead = breaker && chaser ? chaser.firstAt - breaker.firstAt : null;
  const winner = [...outlets].sort((a, b) => b.engagement - a.engagement)[0] ?? null;
  const wonByBreaker = Boolean(winner && breaker && winner.id === breaker.id);

  return (
    <aside
      className={cn(
        'flex max-h-[calc(100dvh-7rem)] flex-col overflow-hidden rounded-lg border border-zinc-200 bg-white',
        'dark:border-zinc-800 dark:bg-zinc-900/40',
        className,
      )}
      aria-label="Story detail"
    >
      <header className="flex items-start gap-2 border-b border-zinc-200 px-4 py-3 dark:border-zinc-800">
        <div className="min-w-0 flex-1">
          <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-accent-600 dark:text-accent-500">
            Story
          </p>
          <h3 className="mt-1 text-sm font-semibold leading-snug text-zinc-900 dark:text-zinc-100">
            {truncate(story.label, 160)}
          </h3>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close story detail"
          className="-mr-1 mt-0.5 inline-flex h-6 w-6 shrink-0 items-center justify-center rounded text-zinc-400 transition-colors hover:bg-zinc-100 hover:text-zinc-900 dark:hover:bg-zinc-800 dark:hover:text-zinc-100"
        >
          <X className="h-3.5 w-3.5" aria-hidden />
        </button>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto">
        <dl className="grid grid-cols-2 gap-3 border-b border-zinc-200 px-4 py-3 dark:border-zinc-800">
          <Figure label="Outlets" value={String(story.companies.length)} />
          <Figure label="Posts" value={String(story.posts.length)} />
          <Figure label="Engagement" value={compactNumber(story.totalEngagement)} />
          <Figure label="Span" value={durationLabel(lastAt - firstAt)} />
        </dl>

        <section className="border-b border-zinc-200 px-4 py-3 dark:border-zinc-800">
          <p className="text-[10px] font-medium uppercase tracking-wider text-zinc-400 dark:text-zinc-500">
            Who got there first
          </p>
          {breaker ? (
            <p className="mt-1 text-xs leading-relaxed text-zinc-700 dark:text-zinc-300">
              <span className="font-semibold text-zinc-900 dark:text-zinc-100">{breaker.name}</span>
              {' posted first at '}
              <span className="pb-num">{formatDateTime(breaker.posts[0].postedAt)}</span>
              {lead !== null && chaser
                ? ', ' + durationLabel(lead) + ' ahead of ' + chaser.name + '.'
                : '. No other outlet in this landscape followed.'}
            </p>
          ) : (
            <p className="mt-1 text-xs text-zinc-500">No posts in this cluster.</p>
          )}
          {winner ? (
            <p className="mt-2 text-xs leading-relaxed text-zinc-700 dark:text-zinc-300">
              <span className="font-semibold text-zinc-900 dark:text-zinc-100">{winner.name}</span>
              {' took the most engagement, '}
              <span className="pb-num">{compactNumber(winner.engagement)}</span>
              {wonByBreaker ? ', and also broke it.' : ', without breaking it.'}
            </p>
          ) : null}
        </section>

        <section className="border-b border-zinc-200 px-4 py-3 dark:border-zinc-800">
          <div className="flex items-center gap-2">
            <Badge tone={band.tone}>{band.label}</Badge>
            <span className="pb-num text-[11px] text-zinc-500 dark:text-zinc-500">
              {'cohesion ' + story.cohesion.toFixed(2)}
            </span>
          </div>
          <p className="mt-1.5 text-[11px] leading-relaxed text-zinc-500 dark:text-zinc-400">{band.body}</p>
          {story.keywords.length > 0 ? (
            <div className="mt-2 flex flex-wrap gap-1">
              {story.keywords.map((k) => (
                <Badge key={k} tone="outline">
                  {k}
                </Badge>
              ))}
            </div>
          ) : null}
        </section>

        <section className="px-4 py-3">
          <p className="text-[10px] font-medium uppercase tracking-wider text-zinc-400 dark:text-zinc-500">
            Timeline
          </p>
          <ol className="mt-2 space-y-3">
            {outlets.map((outlet, index) => (
              <li key={outlet.id} className="relative pl-4">
                <span
                  aria-hidden
                  className={cn(
                    'absolute left-0 top-1.5 h-1.5 w-1.5 rounded-full',
                    index === 0 ? 'bg-accent-600' : 'bg-zinc-300 dark:bg-zinc-600',
                  )}
                />
                {index < outlets.length - 1 ? (
                  <span
                    aria-hidden
                    className="absolute left-[2.5px] top-4 bottom-[-0.75rem] w-px bg-zinc-200 dark:bg-zinc-800"
                  />
                ) : null}
                <div className="flex items-baseline justify-between gap-2">
                  <p className="min-w-0 truncate text-xs font-semibold text-zinc-900 dark:text-zinc-100">
                    {outlet.name}
                  </p>
                  <p className="pb-num shrink-0 text-[11px] text-zinc-500 dark:text-zinc-500">
                    {index === 0
                      ? 'broke it'
                      : '+' + durationLabel(outlet.firstAt - outlets[0].firstAt)}
                  </p>
                </div>
                <ul className="mt-1 space-y-1">
                  {outlet.posts.map((post) => (
                    <li
                      key={post.id}
                      className="rounded border border-zinc-200 px-2 py-1.5 dark:border-zinc-800"
                    >
                      <div className="flex items-center gap-1.5">
                        <span
                          aria-hidden
                          className="h-1.5 w-1.5 shrink-0 rounded-full"
                          style={{ backgroundColor: PLATFORM_COLORS[post.platform] }}
                        />
                        <span className="pb-num truncate text-[11px] text-zinc-500 dark:text-zinc-500">
                          {PLATFORM_LABELS[post.platform] + ' · ' + formatDateTime(post.postedAt)}
                        </span>
                        <span className="pb-num ml-auto shrink-0 text-[11px] font-medium text-zinc-700 dark:text-zinc-300">
                          {compactNumber(post.engagementTotal)}
                        </span>
                      </div>
                      <p className="mt-1 text-[11px] leading-relaxed text-zinc-600 dark:text-zinc-400">
                        {post.text ? truncate(post.text.replace(/\s+/g, ' ').trim(), 180) : 'No caption.'}
                      </p>
                      {post.permalink ? (
                        <a
                          href={post.permalink}
                          target="_blank"
                          rel="noreferrer noopener"
                          className="mt-1 inline-flex items-center gap-1 text-[11px] font-medium text-accent-600 hover:underline dark:text-accent-500"
                        >
                          Open post
                          <ExternalLink className="h-2.5 w-2.5" aria-hidden />
                        </a>
                      ) : null}
                    </li>
                  ))}
                </ul>
              </li>
            ))}
          </ol>
        </section>
      </div>
    </aside>
  );
}
