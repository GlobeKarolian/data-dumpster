import * as React from 'react';
import {
  ExternalLink, Flame, Heart, ImageOff, MessageCircle, Play, Repeat2,
} from 'lucide-react';
import type { PostDto } from '@/lib/metrics/contract';
import { postPosterUrl } from '@/lib/post-preview-url';
import { platformMetricLabel } from '@/lib/platform-language';
import { cn, compactNumber } from '@/lib/utils';
import { Badge, PlatformBadge } from '@/components/ui/badge';
import { Tooltip } from '@/components/ui/tooltip';
import { formatDateTime, formatMetric, truncate } from '@/components/ui/format';

/** Threshold above which a post is called out as an outlier rather than a good day. */
export const OUTLIER_THRESHOLD = 3;

export function OutlierBadge({ score }: { score: number }) {
  return (
    <Tooltip
      side="top"
      content={
        <span className="block">
          <span className="block font-medium text-zinc-900 dark:text-zinc-100">Outlier</span>
          <span className="pb-num block text-zinc-600 dark:text-zinc-400">
            {score.toFixed(1) + 'x this account’s median engagement for the platform in this window.'}
          </span>
          <span className="mt-1 block text-zinc-500">
            Worth reading before it goes in a deck: one post this far above the line usually has a
            specific cause.
          </span>
        </span>
      }
    >
      <span tabIndex={0}>
        <Badge tone="accent">
          <Flame className="h-2.5 w-2.5" aria-hidden />
          {score.toFixed(1) + 'x'}
        </Badge>
      </span>
    </Tooltip>
  );
}

function MetricChip({
  icon: Icon,
  value,
  label,
}: {
  icon: React.ComponentType<{ className?: string }>;
  value: number;
  label: string;
}) {
  return (
    <span className="inline-flex items-center gap-1 text-[11px] text-zinc-500 dark:text-zinc-400" title={label}>
      <Icon className="h-3 w-3" aria-hidden />
      <span className="pb-num">{compactNumber(value)}</span>
      <span className="sr-only">{label}</span>
    </span>
  );
}

export function PostCard({
  post,
  className,
  onSelect,
}: {
  post: PostDto;
  className?: string;
  onSelect?: (post: PostDto) => void;
}) {
  const outlier = post.outlierScore !== null && post.outlierScore > OUTLIER_THRESHOLD;
  const previewUrl = postPosterUrl(post);
  const [previewFailed, setPreviewFailed] = React.useState(false);
  const isMotion = ['video', 'reel', 'short', 'live'].includes(post.type);

  return (
    <article
      onClick={onSelect ? () => onSelect(post) : undefined}
      onKeyDown={onSelect ? (event) => {
        if (event.target !== event.currentTarget) return;
        if (event.key !== 'Enter' && event.key !== ' ') return;
        event.preventDefault();
        onSelect(post);
      } : undefined}
      role={onSelect ? 'button' : undefined}
      tabIndex={onSelect ? 0 : undefined}
      aria-label={onSelect ? 'View post details for ' + post.company.name : undefined}
      className={cn(
        'flex h-full flex-col rounded-lg border border-zinc-200 bg-white p-3 transition-colors',
        'hover:border-zinc-300 dark:border-zinc-800 dark:bg-zinc-900/40 dark:hover:border-zinc-700',
        onSelect && [
          'cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-500',
          'focus-visible:ring-offset-2 focus-visible:ring-offset-white dark:focus-visible:ring-offset-zinc-950',
        ],
        className,
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="truncate text-xs font-medium text-zinc-900 dark:text-zinc-100">{post.company.name}</p>
          <div className="mt-0.5 flex items-center gap-2">
            <PlatformBadge platform={post.platform} />
            <span className="pb-num text-[11px] text-zinc-400">{formatDateTime(post.postedAt)}</span>
          </div>
        </div>
        {outlier && post.outlierScore !== null ? <OutlierBadge score={post.outlierScore} /> : null}
      </div>

      {previewUrl ? (
        <div className="relative mt-2.5 flex h-28 items-center justify-center overflow-hidden rounded border border-zinc-200 bg-zinc-100 text-zinc-400 dark:border-zinc-800 dark:bg-zinc-800 dark:text-zinc-500">
          {previewFailed ? (
            isMotion
              ? <Play className="h-7 w-7 fill-current" aria-hidden />
              : <ImageOff className="h-6 w-6" aria-hidden />
          ) : (
            // Remote thumbnails come from arbitrary CDNs, so a plain img avoids
            // needing every social platform in the image optimizer allowlist.
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={previewUrl}
              alt=""
              loading="lazy"
              className="h-full w-full object-cover"
              onError={() => setPreviewFailed(true)}
            />
          )}
          {!previewFailed && isMotion ? (
            <span className="pointer-events-none absolute inset-0 flex items-center justify-center bg-black/10">
              <span className="flex h-10 w-10 items-center justify-center rounded-full bg-black/60 text-white shadow-lg">
                <Play className="ml-0.5 h-4 w-4 fill-current" aria-hidden />
              </span>
            </span>
          ) : null}
        </div>
      ) : null}

      <p className="mt-2.5 flex-1 text-xs leading-relaxed text-zinc-600 dark:text-zinc-400">
        {post.text ? truncate(post.text, 180) : <span className="italic text-zinc-400">No caption</span>}
      </p>

      {post.tags.length > 0 ? (
        <ul className="mt-2 flex flex-wrap gap-1">
          {post.tags.slice(0, 4).map((t) => (
            <li key={t.id}>
              <Badge tone="outline">{t.name}</Badge>
            </li>
          ))}
        </ul>
      ) : null}

      <div className="mt-3 flex items-center justify-between gap-2 border-t border-zinc-100 pt-2.5 dark:border-zinc-800">
        <div className="flex items-center gap-2.5">
          <MetricChip
            icon={Heart}
            value={post.applause}
            label={platformMetricLabel('applause', post.platform)}
          />
          <MetricChip
            icon={MessageCircle}
            value={post.conversation}
            label={platformMetricLabel('conversation', post.platform)}
          />
          <MetricChip
            icon={Repeat2}
            value={post.amplification}
            label={platformMetricLabel('amplification', post.platform)}
          />
        </div>
        <div className="flex items-center gap-2">
          <span className="pb-num text-xs font-semibold text-zinc-900 dark:text-zinc-100">
            {formatMetric(post.engagementTotal, 'engagementTotal')}
          </span>
          {post.permalink ? (
            <a
              href={post.permalink}
              target="_blank"
              rel="noopener noreferrer"
              onClick={(event) => event.stopPropagation()}
              className="text-zinc-400 transition-colors hover:text-accent-600"
              aria-label={'Open the original post by ' + post.company.name}
            >
              <ExternalLink className="h-3.5 w-3.5" aria-hidden />
            </a>
          ) : null}
        </div>
      </div>
    </article>
  );
}
