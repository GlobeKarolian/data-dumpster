import * as React from 'react';
import { ExternalLink, Flame, Heart, MessageCircle, Repeat2 } from 'lucide-react';
import type { PostDto } from '@/lib/metrics/contract';
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

export function PostCard({ post, className }: { post: PostDto; className?: string }) {
  const outlier = post.outlierScore !== null && post.outlierScore > OUTLIER_THRESHOLD;
  return (
    <article
      className={cn(
        'flex h-full flex-col rounded-lg border border-zinc-200 bg-white p-3 transition-colors',
        'hover:border-zinc-300 dark:border-zinc-800 dark:bg-zinc-900/40 dark:hover:border-zinc-700',
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

      {post.thumbnailUrl ? (
        <div className="mt-2.5 overflow-hidden rounded border border-zinc-200 dark:border-zinc-800">
          {/* Remote thumbnails come from arbitrary CDNs, so a plain img avoids
              needing every social platform in the image optimizer allowlist. */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={post.thumbnailUrl}
            alt=""
            loading="lazy"
            className="h-28 w-full bg-zinc-100 object-cover dark:bg-zinc-800"
          />
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
          <MetricChip icon={Heart} value={post.applause} label="Applause" />
          <MetricChip icon={MessageCircle} value={post.conversation} label="Conversation" />
          <MetricChip icon={Repeat2} value={post.amplification} label="Amplification" />
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
