'use client';

/**
 * One tag, one destination.
 *
 * A tag name anywhere in the product is a question — "what have we all posted
 * about this?" — and the Social Posts explorer already knows how to answer it:
 * filter, sort, per-outlet comparison, engagement, the full record. So every
 * tag chip links there, filtered to the tag, carrying the viewer's current
 * landscape and window. No parallel "tag detail" surface to maintain; the tag
 * IS a filter, and clicking it applies it.
 *
 * stopPropagation because chips live inside clickable post rows and cards —
 * a click on the tag means the tag, not the post behind it.
 */
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { hrefWithGlobalParams } from '@/components/common/use-url-state';
import { Badge } from '@/components/ui/badge';

export function TagLink({ tag }: { tag: { id: string; name: string } }) {
  const searchParams = useSearchParams();
  return (
    <Link
      href={hrefWithGlobalParams('/posts', searchParams, { tags: tag.id })}
      prefetch={false}
      onClick={(event) => event.stopPropagation()}
      title={`All posts tagged “${tag.name}”`}
      className="rounded-full transition-opacity hover:opacity-70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-500"
    >
      <Badge tone="outline">{tag.name}</Badge>
    </Link>
  );
}
