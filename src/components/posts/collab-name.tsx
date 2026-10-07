import * as React from 'react';
import { cn } from '@/lib/utils';

/**
 * A post's account name. A collab (one post published jointly by two tracked
 * accounts, collected from both profiles) is listed once, so it names every
 * account and carries a small Collab marker.
 */
export { collabLabel } from '@/lib/collab-label';

export function CollabName({ name, collaborators, className, badgeClassName }: {
  name: string;
  collaborators?: { name: string }[] | string[] | null;
  className?: string;
  badgeClassName?: string;
}) {
  const others = (collaborators ?? []).map((c) => (typeof c === 'string' ? c : c.name));
  if (!others.length) return <span className={className}>{name}</span>;
  return (
    <span className={cn('inline-flex min-w-0 max-w-full items-center gap-1.5', className)} title={`Collab: ${[name, ...others].join(', ')}`}>
      <span className="truncate">{[name, ...others].join(' × ')}</span>
      <span className={cn('shrink-0 rounded bg-violet-100 px-1 py-px text-[10px] font-semibold uppercase tracking-wide text-violet-700 dark:bg-violet-950/60 dark:text-violet-300', badgeClassName)}>
        Collab
      </span>
    </span>
  );
}
