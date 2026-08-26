'use client';

import * as React from 'react';
import {
  AtSign,
  Bookmark,
  ChevronDown,
  Clock3,
  ExternalLink,
  Hash,
  Heart,
  ImageOff,
  Images,
  Link2,
  MessageCircle,
  Play,
  Repeat2,
  RotateCcw,
  TrendingUp,
  X,
} from 'lucide-react';
import { PLATFORM_COLORS, PLATFORM_LABELS, type MetricKey, type Platform } from '@/lib/types';
import type { PostDetailDto, PostDto } from '@/lib/metrics/contract';
import {
  platformAudienceNoun,
  platformHandleLabel,
  platformMetricLabel,
} from '@/lib/platform-language';
import { postPosterUrl, postVideoUrl } from '@/lib/post-preview-url';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Badge, PlatformBadge } from '@/components/ui/badge';
import { TagLink } from '@/components/tags/tag-link';
import { Dialog } from '@/components/ui/dialog';
import { MetricLabel } from '@/components/ui/metric-label';
import { formatDateTime, formatInteger, formatMetric } from '@/components/ui/format';
import { isPostMetricReported } from './post-metric-availability';

export interface PostDetailDialogProps {
  post: PostDto | null;
  detail: PostDetailDto | null;
  loading: boolean;
  error: string | null;
  onClose: () => void;
  onRetry: () => void;
  /** Keeps expiring social media previews authorized on public report links. */
  reportShareToken?: string;
}

function duration(value: number | null): string {
  if (value === null || value < 0) return '—';
  const total = Math.round(value);
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return minutes > 0 ? minutes + 'm ' + String(seconds).padStart(2, '0') + 's' : seconds + 's';
}

function MetricCard({
  metric,
  value,
  platform,
  available = true,
}: {
  metric: MetricKey;
  value: number | null | undefined;
  platform: Platform;
  available?: boolean;
}) {
  return (
    <div className="min-w-0 rounded-lg border border-zinc-200 bg-white px-3.5 py-3 dark:border-zinc-800 dark:bg-zinc-950">
      <p className="text-[11px] text-zinc-500 dark:text-zinc-400">
        <MetricLabel metric={metric} short text={platformMetricLabel(metric, platform)} />
      </p>
      <p className="pb-num mt-1 text-xl font-semibold tracking-tight text-zinc-950 dark:text-zinc-50">
        {available ? formatMetric(value, metric, 'full') : '—'}
      </p>
    </div>
  );
}

function MetaItem({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-[10px] font-semibold uppercase tracking-wider text-zinc-400 dark:text-zinc-500">
        {label}
      </dt>
      <dd className="mt-1 break-words text-xs text-zinc-700 dark:text-zinc-300">{children}</dd>
    </div>
  );
}

function PostPreview({
  post,
  urls,
  mediaUrl,
  thumbnailUrl,
  durationSec,
  hasThumbnail,
  showThumbnail,
  videoFailed,
  onImageError,
  onVideoError,
}: {
  post: PostDto;
  urls: PostDetailDto['urls'];
  mediaUrl: string | null;
  thumbnailUrl: string | null;
  durationSec: number | null;
  hasThumbnail: boolean;
  showThumbnail: boolean;
  videoFailed: boolean;
  onImageError: () => void;
  onVideoError: () => void;
}) {
  const isMotion = ['video', 'reel', 'short', 'live'].includes(post.type);
  const isCarousel = post.type === 'carousel';
  const hasMediaPanel = hasThumbnail || isMotion || isCarousel || post.type === 'photo';
  const playableVideo = isMotion && Boolean(mediaUrl) && !videoFailed;
  const typeLabel = post.type === 'reel'
    ? 'Reel'
    : post.type === 'short'
      ? 'Short'
      : post.type === 'live'
        ? 'Live video'
        : isMotion
          ? 'Video'
          : isCarousel
            ? 'Carousel'
            : 'Photo';

  return (
    <article
      className="overflow-hidden rounded-xl border border-zinc-200 bg-white shadow-sm dark:border-zinc-800 dark:bg-zinc-950"
      style={{ borderLeftColor: PLATFORM_COLORS[post.platform], borderLeftWidth: 3 }}
    >
      {hasMediaPanel ? (
        playableVideo ? (
          <div className="relative flex max-h-[34rem] min-h-72 items-center justify-center bg-zinc-950">
            <video
              src={mediaUrl ?? undefined}
              poster={showThumbnail ? thumbnailUrl ?? undefined : undefined}
              controls
              playsInline
              preload="metadata"
              onError={onVideoError}
              className="max-h-[34rem] w-full bg-black object-contain"
              aria-label={typeLabel + ' from ' + post.company.name + ' on ' + PLATFORM_LABELS[post.platform]}
            />
            <span className="pointer-events-none absolute left-3 top-3 rounded-full bg-black/65 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wider text-white backdrop-blur">
              {typeLabel + (durationSec === null ? '' : ' · ' + duration(durationSec))}
            </span>
          </div>
        ) : showThumbnail ? (
          <div className="relative flex max-h-[34rem] min-h-64 items-center justify-center bg-zinc-950">
            {/* Remote thumbnails come from platform and vendor CDNs. */}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={thumbnailUrl ?? undefined}
              alt={'Media preview from ' + post.company.name + ' on ' + PLATFORM_LABELS[post.platform]}
              className="max-h-[34rem] w-full object-contain"
              onError={onImageError}
            />
            {isMotion ? (
              <>
                <span className="pointer-events-none absolute inset-0 bg-gradient-to-t from-black/45 via-transparent to-black/20" />
                <span className="pointer-events-none absolute left-1/2 top-1/2 flex h-16 w-16 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full border border-white/50 bg-black/55 text-white shadow-xl backdrop-blur-sm">
                  <Play className="ml-1 h-7 w-7 fill-current" aria-hidden />
                </span>
              </>
            ) : null}
            {isMotion || isCarousel ? (
              <span className="pointer-events-none absolute left-3 top-3 inline-flex items-center gap-1.5 rounded-full bg-black/65 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wider text-white backdrop-blur">
                {isCarousel ? <Images className="h-3 w-3" aria-hidden /> : <Play className="h-3 w-3 fill-current" aria-hidden />}
                {typeLabel + (durationSec === null ? '' : ' · ' + duration(durationSec))}
              </span>
            ) : null}
          </div>
        ) : (
          <div
            className="relative flex min-h-80 flex-col items-center justify-center overflow-hidden bg-zinc-950 px-6 text-center text-white"
            style={{
              background:
                'radial-gradient(circle at 25% 20%, '
                + PLATFORM_COLORS[post.platform] + '55, transparent 42%), '
                + 'linear-gradient(145deg, #18181b 0%, #09090b 100%)',
            }}
          >
            <span className="absolute -right-14 -top-14 h-48 w-48 rounded-full border border-white/10" />
            <span className="absolute -bottom-20 -left-10 h-56 w-56 rounded-full border border-white/10" />
            <span className="relative flex h-20 w-20 items-center justify-center rounded-full border border-white/20 bg-white/10 shadow-2xl backdrop-blur-sm">
              {isMotion ? (
                <Play className="ml-1 h-9 w-9 fill-current" aria-hidden />
              ) : isCarousel ? (
                <Images className="h-9 w-9" aria-hidden />
              ) : (
                <ImageOff className="h-8 w-8" aria-hidden />
              )}
            </span>
            <p className="relative mt-4 text-xs font-semibold uppercase tracking-[0.2em] text-white/70">
              {typeLabel + (durationSec === null ? '' : ' · ' + duration(durationSec))}
            </p>
            <p className="relative mt-2 text-sm font-medium text-white">
              {isMotion ? 'Video preview not captured' : typeLabel + ' preview unavailable'}
            </p>
            <p className="relative mt-1 max-w-xs text-[11px] leading-relaxed text-white/55">
              Open the original post to view its media.
            </p>
          </div>
        )
      ) : null}

      <div className="p-4 sm:p-5">
        <p
          className={cn(
            'whitespace-pre-wrap text-[15px] leading-6 text-zinc-900 dark:text-zinc-100',
            !post.text && 'italic text-zinc-400 dark:text-zinc-500',
          )}
        >
          {post.text || 'No caption was captured for this post.'}
        </p>

        {urls.length > 0 ? (
          <ul className="mt-4 space-y-2 border-t border-zinc-100 pt-3 dark:border-zinc-800">
            {urls.map((url) => (
              <li key={url.url} className="flex min-w-0 items-start gap-2">
                <Link2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-zinc-400" aria-hidden />
                <div className="min-w-0">
                  <a
                    href={url.canonicalUrl ?? url.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="block truncate text-xs font-medium text-zinc-800 hover:underline dark:text-zinc-200"
                  >
                    {url.title || url.domain || url.url}
                  </a>
                  {url.title ? (
                    <p className="mt-0.5 truncate text-[11px] text-zinc-500">{url.domain || url.url}</p>
                  ) : null}
                </div>
              </li>
            ))}
          </ul>
        ) : null}
      </div>
    </article>
  );
}

function PerformanceCallout({ post }: { post: PostDto }) {
  if (post.outlierScore === null) return null;
  const breakout = post.outlierScore >= 3;

  return (
    <div
      className={cn(
        'rounded-xl border px-4 py-3.5',
        breakout
          ? 'border-rose-200 bg-rose-50 dark:border-rose-900/60 dark:bg-rose-950/25'
          : 'border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-950',
      )}
    >
      <div className="flex items-center gap-2">
        <TrendingUp
          className={cn('h-4 w-4', breakout ? 'text-rose-600 dark:text-rose-400' : 'text-zinc-500')}
          aria-hidden
        />
        <p
          className={cn(
            'text-xs font-semibold',
            breakout ? 'text-rose-700 dark:text-rose-300' : 'text-zinc-700 dark:text-zinc-300',
          )}
        >
          {breakout ? 'Breakout post' : 'Performance versus median'}
        </p>
      </div>
      <p className="mt-2 text-2xl font-semibold tracking-tight text-zinc-950 dark:text-zinc-50">
        <span className="pb-num">{post.outlierScore.toFixed(1) + '×'}</span>
        <span className="ml-2 text-base font-medium text-zinc-600 dark:text-zinc-400">
          current-view median
        </span>
      </p>
      <p className="mt-1 text-xs text-zinc-600 dark:text-zinc-400">
        {formatInteger(post.engagementTotal) + ' engagements versus a '
          + formatInteger(post.medianEngagement) + ' median among matching '
          + PLATFORM_LABELS[post.platform] + ' posts from ' + post.company.name + '.'}
      </p>
    </div>
  );
}

/**
 * Compact evidence view for one social post. The list record renders
 * immediately; source metadata hydrates from the on-demand detail route.
 */
export function PostDetailDialog({
  post,
  detail,
  loading,
  error,
  onClose,
  onRetry,
  reportShareToken,
}: PostDetailDialogProps) {
  const titleId = React.useId();
  const descriptionId = React.useId();
  const [failedImagePostId, setFailedImagePostId] = React.useState<string | null>(null);
  const [failedAvatarPostId, setFailedAvatarPostId] = React.useState<string | null>(null);
  const [failedVideoPostId, setFailedVideoPostId] = React.useState<string | null>(null);

  if (!post) return null;

  const resolved = detail?.id === post.id ? detail : null;
  const tags = resolved?.tags ?? post.tags.map((tag) => ({ ...tag, source: null, confidence: null }));
  const urls = resolved?.urls
    ?? post.urls.map((url) => ({ ...url, canonicalUrl: null, title: null }));
  const thumbnailUrl = postPosterUrl(post, { reportShareToken });
  const mediaUrl = postVideoUrl(post, resolved?.mediaUrl ?? null, { reportShareToken });
  const hasThumbnail = Boolean(thumbnailUrl);
  const showThumbnail = hasThumbnail && failedImagePostId !== post.id;
  const isMotion = ['video', 'reel', 'short', 'live'].includes(post.type);
  const hasVisual = hasThumbnail || isMotion || post.type === 'carousel' || post.type === 'photo';
  const avatarUrl = resolved?.channel.avatarUrl ?? post.company.logoUrl;
  const showAvatar = Boolean(avatarUrl) && failedAvatarPostId !== post.id;
  const initial = post.company.name.trim().slice(0, 1).toUpperCase() || '?';
  const followerRateAvailable = post.followersAtPost !== null && post.followersAtPost > 0;
  const viewRateAvailable = resolved?.engagementRateByView !== null
    && resolved?.engagementRateByView !== undefined;
  const viewsAvailable = isPostMetricReported(post.platform, post.type, 'views', post.views)
    || viewRateAvailable;
  const history = resolved?.metricHistory.slice(-8).reverse() ?? [];

  const metrics: {
    metric: MetricKey;
    value: number | null | undefined;
    available?: boolean;
  }[] = [
    { metric: 'engagementTotal', value: post.engagementTotal },
    {
      metric: 'engagementRateByFollower',
      value: post.engagementRateByFollower,
      available: followerRateAvailable,
    },
  ];
  if (viewsAvailable) metrics.push({ metric: 'views', value: post.views });
  if (viewRateAvailable) {
    metrics.push({
      metric: 'engagementRateByView',
      value: resolved?.engagementRateByView,
      available: true,
    });
  }

  const reactions = [
    { icon: Heart, metric: 'applause' as const, value: post.applause },
    { icon: MessageCircle, metric: 'conversation' as const, value: post.conversation },
    { icon: Repeat2, metric: 'amplification' as const, value: post.amplification },
    { icon: Bookmark, metric: 'saves' as const, value: post.saves },
  ].filter((reaction) =>
    isPostMetricReported(post.platform, post.type, reaction.metric, reaction.value));

  const hasClassification = tags.length > 0
    || Boolean(resolved?.hashtags.length)
    || Boolean(resolved?.mentions.length);

  return (
    <Dialog
      open
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
      labelledBy={titleId}
      describedBy={descriptionId}
      className={cn(
        'flex max-h-[calc(100dvh-1.5rem)] flex-col rounded-none sm:max-h-[calc(100dvh-3rem)] sm:rounded-xl',
        hasVisual ? 'max-w-5xl' : 'max-w-3xl',
      )}
    >
      <header className="flex shrink-0 items-start justify-between gap-4 border-b border-zinc-200 px-4 py-3.5 dark:border-zinc-800 sm:px-5">
        <div className="flex min-w-0 items-center gap-3">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-full bg-zinc-900 text-xs font-semibold text-white dark:bg-zinc-100 dark:text-zinc-950">
            {showAvatar ? (
              // Channel avatars are remote and can expire independently of the post.
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={avatarUrl ?? undefined}
                alt=""
                className="h-full w-full object-cover"
                onError={() => setFailedAvatarPostId(post.id)}
              />
            ) : (
              <span aria-hidden>{initial}</span>
            )}
          </span>
          <div className="min-w-0">
            <h2 id={titleId} className="truncate text-sm font-semibold text-zinc-950 dark:text-zinc-50">
              {post.company.name}
            </h2>
            <div id={descriptionId} className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1">
              <PlatformBadge platform={post.platform} />
              <span className="text-zinc-300 dark:text-zinc-700" aria-hidden>·</span>
              <span className="pb-num text-[11px] text-zinc-500 dark:text-zinc-400">
                {formatDateTime(post.postedAt)}
              </span>
              <Badge tone="outline" className="capitalize">{post.type}</Badge>
            </div>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          {post.permalink ? (
            <a
              href={post.permalink}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex h-9 items-center gap-1.5 rounded-md border border-zinc-200 px-2.5 text-xs font-medium text-zinc-700 transition-colors hover:bg-zinc-100 dark:border-zinc-800 dark:text-zinc-300 dark:hover:bg-zinc-800"
            >
              <ExternalLink className="h-3.5 w-3.5" aria-hidden />
              <span className="hidden sm:inline">
                {'Open on ' + PLATFORM_LABELS[post.platform]}
              </span>
            </a>
          ) : null}
          <Button
            type="button"
            size="icon"
            variant="ghost"
            onClick={onClose}
            aria-label="Close post details"
            data-dialog-initial-focus
            className="h-9 w-9"
          >
            <X className="h-4 w-4" aria-hidden />
          </Button>
        </div>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto bg-zinc-50/80 dark:bg-zinc-900/30">
        <div
          className={cn(
            'mx-auto grid gap-4 p-4 sm:gap-5 sm:p-5',
            hasVisual
              ? 'lg:grid-cols-[minmax(18rem,0.82fr)_minmax(0,1.18fr)]'
              : 'max-w-3xl',
          )}
        >
          <div className={cn(hasVisual && 'lg:sticky lg:top-5 lg:self-start')}>
            <PostPreview
              post={post}
              urls={urls}
              mediaUrl={mediaUrl}
              thumbnailUrl={thumbnailUrl}
              durationSec={resolved?.durationSec ?? null}
              hasThumbnail={hasThumbnail}
              showThumbnail={showThumbnail}
              videoFailed={failedVideoPostId === post.id}
              onImageError={() => setFailedImagePostId(post.id)}
              onVideoError={() => setFailedVideoPostId(post.id)}
            />
          </div>

          <div className="min-w-0 space-y-4">
            <PerformanceCallout post={post} />

            <section aria-labelledby={titleId + '-performance'}>
              <div className="mb-2.5 flex items-center justify-between gap-3">
                <div>
                  <h3
                    id={titleId + '-performance'}
                    className="text-sm font-semibold text-zinc-900 dark:text-zinc-100"
                  >
                    Performance
                  </h3>
                  <p className="mt-0.5 text-[11px] text-zinc-500">
                    Latest captured totals.
                  </p>
                </div>
              </div>
              <div className={cn('grid gap-2', metrics.length > 1 && 'grid-cols-2')}>
                {metrics.map((metric) => (
                  <MetricCard key={metric.metric} {...metric} platform={post.platform} />
                ))}
              </div>
            </section>

            <section className="rounded-xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-950">
              <h3 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
                Reactions captured
              </h3>
              {reactions.length > 0 ? (
                <div className="mt-3 grid grid-cols-[repeat(auto-fit,minmax(7rem,1fr))] gap-2">
                  {reactions.map(({ icon: Icon, metric, value }) => (
                    <div
                      key={metric}
                      className="flex items-center gap-2 rounded-lg bg-zinc-50 px-3 py-2 dark:bg-zinc-900"
                    >
                      <Icon className="h-3.5 w-3.5 shrink-0 text-zinc-400" aria-hidden />
                      <span className="min-w-0">
                        <span className="block text-[10px] text-zinc-500">
                          <MetricLabel
                            metric={metric}
                            short
                            text={platformMetricLabel(metric, post.platform)}
                          />
                        </span>
                        <span className="pb-num block text-sm font-semibold text-zinc-900 dark:text-zinc-100">
                          {formatMetric(value, metric, 'full')}
                        </span>
                      </span>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="mt-2 text-xs text-zinc-500">
                  No reaction breakdown was reported for this post.
                </p>
              )}
            </section>

            {resolved && resolved.comments.collected > 0 ? (
              <section className="rounded-xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-950">
                <div className="flex items-baseline justify-between gap-3">
                  <h3 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
                    What commenters are saying
                  </h3>
                  <span className="pb-num shrink-0 text-[11px] tabular-nums text-zinc-500">
                    {formatInteger(resolved.comments.collected)
                      + (resolved.comments.collected === 1 ? ' comment' : ' comments')
                      + ' collected'}
                  </span>
                </div>
                {resolved.comments.summary ? (
                  <div className="mt-3 rounded-lg bg-zinc-50 px-3.5 py-3 dark:bg-zinc-900">
                    <p className="text-[13px] leading-relaxed text-zinc-800 dark:text-zinc-200">
                      {resolved.comments.summary}
                    </p>
                    <p className="mt-1.5 text-[10px] uppercase tracking-wide text-zinc-400">
                      AI summary of the collected section
                    </p>
                  </div>
                ) : null}
                <ul className="mt-3 space-y-2.5">
                  {resolved.comments.items.map((comment) => (
                    <li key={comment.id} className="flex gap-3">
                      <span className="pb-num w-10 shrink-0 pt-0.5 text-right text-xs font-semibold tabular-nums text-zinc-500">
                        {comment.likes > 0 ? formatInteger(comment.likes) + ' ♥' : ''}
                      </span>
                      <div className="min-w-0">
                        <p className="text-[13px] leading-relaxed text-zinc-800 dark:text-zinc-200">
                          {comment.text}
                        </p>
                        <p className="mt-0.5 text-[10px] text-zinc-400">
                          {(comment.commentedAt ? formatDateTime(comment.commentedAt) : '')
                            + (comment.replies > 0
                              ? (comment.commentedAt ? ' · ' : '')
                                + comment.replies
                                + (comment.replies === 1 ? ' reply' : ' replies')
                              : '')}
                        </p>
                      </div>
                    </li>
                  ))}
                </ul>
                <p className="mt-3 border-t border-zinc-100 pt-2.5 text-[10px] leading-relaxed text-zinc-400 dark:border-zinc-800">
                  Most-liked of the collected sample. Commenter identities are stored but not
                  displayed.
                </p>
              </section>
            ) : null}

            {hasClassification ? (
              <section className="rounded-xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-950">
                <h3 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
                  Classification
                </h3>
                <div className="mt-3 space-y-2.5">
                  {tags.length > 0 ? (
                    <div className="flex flex-wrap gap-1.5">
                      {tags.map((tag) => (
                        <TagLink key={tag.id} tag={tag} />
                      ))}
                    </div>
                  ) : null}
                  {resolved?.hashtags.length ? (
                    <div className="flex flex-wrap items-center gap-1.5">
                      <Hash className="h-3.5 w-3.5 text-zinc-400" aria-hidden />
                      {resolved.hashtags.map((hashtag) => (
                        <Badge key={hashtag} tone="neutral">
                          {'#' + hashtag.replace(/^#/, '')}
                        </Badge>
                      ))}
                    </div>
                  ) : null}
                  {resolved?.mentions.length ? (
                    <div className="flex flex-wrap items-center gap-1.5">
                      <AtSign className="h-3.5 w-3.5 text-zinc-400" aria-hidden />
                      {resolved.mentions.map((mention) => (
                        <Badge key={mention} tone="neutral">
                          {'@' + mention.replace(/^@/, '')}
                        </Badge>
                      ))}
                    </div>
                  ) : null}
                </div>
              </section>
            ) : null}

            {loading && !resolved ? (
              <div
                role="status"
                aria-live="polite"
                className="flex items-center gap-2 rounded-lg border border-zinc-200 bg-white px-3 py-2.5 text-xs text-zinc-500 dark:border-zinc-800 dark:bg-zinc-950"
              >
                <RotateCcw className="h-3.5 w-3.5 animate-spin" aria-hidden />
                Loading profile and freshness details…
              </div>
            ) : error && !resolved ? (
              <div
                role="alert"
                className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2.5 dark:border-red-900/60 dark:bg-red-950/25"
              >
                <p className="text-xs text-red-700 dark:text-red-300">{error}</p>
                <Button type="button" size="sm" onClick={onRetry}>
                  <RotateCcw className="h-3 w-3" aria-hidden />
                  Retry
                </Button>
              </div>
            ) : resolved ? (
              <details className="group overflow-hidden rounded-xl border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-950">
                <summary className="flex cursor-pointer list-none items-center justify-between gap-4 px-4 py-3.5">
                  <div>
                    <p className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
                      Post details
                    </p>
                    <p className="mt-0.5 text-[11px] text-zinc-500">
                      {platformHandleLabel(post.platform, resolved.channel.handle) + ' · refreshed '
                        + formatDateTime(resolved.lastRefreshedAt)}
                    </p>
                  </div>
                  <ChevronDown
                    className="h-4 w-4 shrink-0 text-zinc-400 transition-transform group-open:rotate-180"
                    aria-hidden
                  />
                </summary>
                <div className="border-t border-zinc-100 px-4 py-4 dark:border-zinc-800">
                  <dl className="grid grid-cols-2 gap-x-5 gap-y-4">
                    <MetaItem label="Profile">
                      {resolved.channel.profileUrl ? (
                        <a
                          href={resolved.channel.profileUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="hover:underline"
                        >
                          {platformHandleLabel(post.platform, resolved.channel.handle)}
                        </a>
                      ) : (
                        platformHandleLabel(post.platform, resolved.channel.handle)
                      )}
                    </MetaItem>
                    <MetaItem
                      label={
                        post.platform === 'reddit' && /^u\//i.test(resolved.channel.handle)
                          ? 'Audience at posting'
                          : platformAudienceNoun(post.platform) + ' at posting'
                      }
                    >
                      {post.platform === 'reddit'
                        && /^u\//i.test(resolved.channel.handle)
                        && post.followersAtPost === null
                        ? 'Not exposed by Reddit'
                        : post.followersAtPost === null
                          ? '—'
                          : formatInteger(post.followersAtPost)}
                    </MetaItem>
                    {resolved.durationSec !== null ? (
                      <MetaItem label="Duration">{duration(resolved.durationSec)}</MetaItem>
                    ) : null}
                    {resolved.language ? (
                      <MetaItem label="Language">{resolved.language}</MetaItem>
                    ) : null}
                    <MetaItem label="First collected">
                      <span className="inline-flex items-center gap-1.5">
                        <Clock3 className="h-3 w-3 text-zinc-400" aria-hidden />
                        {formatDateTime(resolved.firstSeenAt)}
                      </span>
                    </MetaItem>
                    <MetaItem label="Last refreshed">
                      {formatDateTime(resolved.lastRefreshedAt)}
                    </MetaItem>
                  </dl>

                  {history.length > 1 ? (
                    <div className="mt-5 border-t border-zinc-100 pt-4 dark:border-zinc-800">
                      <p className="text-xs font-semibold text-zinc-700 dark:text-zinc-300">
                        Collection history
                      </p>
                      <div className="mt-2 overflow-x-auto">
                        <table className="w-full min-w-[27rem] border-collapse text-[11px]">
                          <thead>
                            <tr className="text-left text-zinc-400">
                              <th className="border-b border-zinc-200 py-2 pr-3 font-medium dark:border-zinc-800">
                                Captured
                              </th>
                              <th className="border-b border-zinc-200 px-3 py-2 text-right font-medium dark:border-zinc-800">
                                Engagement
                              </th>
                              <th className="border-b border-zinc-200 px-3 py-2 text-right font-medium dark:border-zinc-800">
                                Views
                              </th>
                              <th className="border-b border-zinc-200 py-2 pl-3 text-right font-medium dark:border-zinc-800">
                                Eng./view
                              </th>
                            </tr>
                          </thead>
                          <tbody>
                            {history.map((snapshot) => (
                              <tr key={snapshot.capturedAt}>
                                <td className="border-b border-zinc-100 py-2 pr-3 dark:border-zinc-800/60">
                                  {formatDateTime(snapshot.capturedAt)}
                                </td>
                                <td className="pb-num border-b border-zinc-100 px-3 py-2 text-right dark:border-zinc-800/60">
                                  {formatInteger(snapshot.engagementTotal)}
                                </td>
                                <td className="pb-num border-b border-zinc-100 px-3 py-2 text-right dark:border-zinc-800/60">
                                  {snapshot.views > 0 ? formatInteger(snapshot.views) : '—'}
                                </td>
                                <td className="pb-num border-b border-zinc-100 py-2 pl-3 text-right dark:border-zinc-800/60">
                                  {snapshot.engagementRateByView === null
                                    ? '—'
                                    : formatMetric(
                                      snapshot.engagementRateByView,
                                      'engagementRateByView',
                                      'full',
                                    )}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  ) : null}
                </div>
              </details>
            ) : null}
          </div>
        </div>
      </div>
    </Dialog>
  );
}
