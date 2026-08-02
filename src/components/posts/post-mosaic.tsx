import * as React from 'react';
import { FileText, Play } from 'lucide-react';
import type { PostDto } from '@/lib/metrics/contract';
import { postPosterUrl } from '@/lib/post-preview-url';
import { PLATFORM_LABELS } from '@/lib/types';
import { cn } from '@/lib/utils';
import { PlatformBadge } from '@/components/ui/badge';
import { formatDateTime, formatMetric, truncate } from '@/components/ui/format';

function MosaicMedia({ post }: { post: PostDto }) {
  const [failed, setFailed] = React.useState(false);
  const previewUrl = postPosterUrl(post);
  const isMotion = ['video', 'reel', 'short', 'live'].includes(post.type);

  if (!previewUrl || failed) {
    return (
      <span className="absolute inset-0 flex flex-col items-center justify-center gap-2 p-4 text-center">
        {isMotion ? (
          <Play className="h-6 w-6 fill-current text-zinc-300 dark:text-zinc-700" aria-hidden />
        ) : (
          <FileText className="h-5 w-5 text-zinc-300 dark:text-zinc-700" aria-hidden />
        )}
        <span className="text-[11px] leading-relaxed text-zinc-500 dark:text-zinc-400">
          {post.text ? truncate(post.text, 100) : 'No media or caption captured'}
        </span>
      </span>
    );
  }

  return (
    <>
      {/* Remote social previews are intentionally not optimized. */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={previewUrl}
        alt=""
        loading="lazy"
        onError={() => setFailed(true)}
        className="absolute inset-0 h-full w-full object-cover transition-transform duration-200 group-hover:scale-[1.02]"
      />
      {isMotion ? (
        <span className="pointer-events-none absolute inset-0 flex items-center justify-center bg-black/10">
          <span className="flex h-11 w-11 items-center justify-center rounded-full bg-black/60 text-white shadow-lg">
            <Play className="ml-0.5 h-5 w-5 fill-current" aria-hidden />
          </span>
        </span>
      ) : null}
    </>
  );
}

export function PostMosaic({
  posts,
  onSelect,
  className,
}: {
  posts: PostDto[];
  onSelect: (post: PostDto) => void;
  className?: string;
}) {
  return (
    <div className={cn('grid grid-cols-2 gap-1.5 p-3 sm:grid-cols-3 lg:grid-cols-4 2xl:grid-cols-6', className)}>
      {posts.map((post) => (
        <button
          key={post.id}
          type="button"
          onClick={() => onSelect(post)}
          aria-label={
            'View post details for ' + post.company.name + ' on ' + PLATFORM_LABELS[post.platform]
          }
          className={cn(
            'group relative aspect-square overflow-hidden rounded-md border border-zinc-200 bg-zinc-100 text-left',
            'transition-colors hover:border-zinc-400 focus-visible:outline-none focus-visible:ring-2',
            'focus-visible:ring-accent-500 dark:border-zinc-800 dark:bg-zinc-900 dark:hover:border-zinc-600',
          )}
        >
          <MosaicMedia post={post} />

          <span
            aria-hidden
            className="absolute inset-x-0 bottom-0 h-3/4 bg-gradient-to-t from-black/90 via-black/45 to-transparent"
          />
          <span className="absolute inset-x-0 bottom-0 block p-2.5 text-white">
            <span className="flex items-center justify-between gap-2">
              <span className="truncate text-[11px] font-semibold">{post.company.name}</span>
              <PlatformBadge
                platform={post.platform}
                showLabel={false}
                className="rounded bg-black/45 px-1.5 py-1 text-white"
              />
            </span>
            {postPosterUrl(post) && post.text ? (
              <span className="mt-1 block truncate text-[10px] text-white/80">
                {post.text}
              </span>
            ) : null}
            <span className="mt-1.5 flex items-center justify-between gap-2 text-[10px] text-white/70">
              <span className="pb-num truncate">{formatDateTime(post.postedAt)}</span>
              <span className="pb-num shrink-0 font-semibold text-white">
                {formatMetric(post.engagementTotal, 'engagementTotal')}
                <span className="sr-only"> total engagement</span>
              </span>
            </span>
          </span>
        </button>
      ))}
    </div>
  );
}
