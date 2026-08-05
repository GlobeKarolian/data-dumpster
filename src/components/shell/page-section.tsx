import * as React from 'react';
import { cn } from '@/lib/utils';

/** Section heading used inside pages, below the top bar. */
export function PageSection({
  id,
  title,
  description,
  actions,
  children,
  className,
}: {
  id?: string;
  title: string;
  description?: React.ReactNode;
  actions?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section id={id} className={cn('scroll-mt-24 mb-6 last:mb-0', className)}>
      <div className="mb-3 flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-[13px] font-semibold tracking-tight text-zinc-900 dark:text-zinc-100">
            {title}
          </h2>
          {description ? (
            <p className="mt-0.5 max-w-2xl text-xs leading-relaxed text-zinc-500 dark:text-zinc-400">
              {description}
            </p>
          ) : null}
        </div>
        {actions ? <div className="flex shrink-0 items-center gap-2">{actions}</div> : null}
      </div>
      {children}
    </section>
  );
}

/** Full-width intro block for screens that need to explain themselves. */
export function PageIntro({
  title,
  children,
  actions,
}: {
  title: string;
  children: React.ReactNode;
  actions?: React.ReactNode;
}) {
  return (
    <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
      <div className="min-w-0 max-w-2xl">
        <h2 className="text-base font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">{title}</h2>
        <div className="mt-1 text-sm leading-relaxed text-zinc-600 dark:text-zinc-400">{children}</div>
      </div>
      {actions ? <div className="flex shrink-0 items-center gap-2">{actions}</div> : null}
    </div>
  );
}
