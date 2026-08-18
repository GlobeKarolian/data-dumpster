import * as React from 'react';
import Link from 'next/link';
import { ArrowUpRight } from 'lucide-react';
import type { Headline } from '@/lib/metrics/week-headline';

const KIND_LABEL: Record<Headline['kind'], string> = {
  standing: 'Standing',
  breakout: 'Breakout',
  story: 'The story',
  volume: 'Volume',
};

/**
 * The first thing anyone sees: what happened, in sentences.
 *
 * Deliberately quiet typography and no chrome. This is not a hero banner, it
 * is the lede on a page of evidence, and it earns attention by being read in
 * fifteen seconds rather than by being loud. Each finding carries its own
 * figure so the claim can be checked, and links where there is somewhere
 * honest to send the reader.
 *
 * Renders nothing when there are no findings. An empty state here would be a
 * box apologising for itself at the top of every screen.
 */
export function WeekHeadline({
  findings,
  windowLabel,
}: {
  findings: Headline[];
  windowLabel: string;
}) {
  if (findings.length === 0) return null;

  return (
    <section
      aria-label="What happened"
      className="rounded-xl border border-zinc-200 bg-white px-5 py-4 dark:border-zinc-800 dark:bg-zinc-900/40"
    >
      <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-zinc-400 dark:text-zinc-500">
        {windowLabel}
      </p>
      <ul className="mt-3 space-y-2.5">
        {findings.map((finding) => {
          const body = (
            <span className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
              <span className="text-[15px] leading-snug text-zinc-900 dark:text-zinc-100">
                {finding.text}
              </span>
              {finding.figure ? (
                <span className="pb-num text-xs tabular-nums text-zinc-500 dark:text-zinc-400">
                  {finding.figure}
                </span>
              ) : null}
              {finding.href ? (
                <ArrowUpRight
                  className="h-3.5 w-3.5 shrink-0 self-center text-zinc-400 transition-transform group-hover:-translate-y-0.5 group-hover:text-zinc-600 dark:group-hover:text-zinc-300"
                  aria-hidden
                />
              ) : null}
            </span>
          );

          return (
            <li key={finding.kind} className="flex gap-3">
              <span className="mt-1 w-16 shrink-0 text-[10px] font-semibold uppercase tracking-wider text-zinc-400 dark:text-zinc-500">
                {KIND_LABEL[finding.kind]}
              </span>
              {finding.href ? (
                finding.href.startsWith('/') ? (
                  <Link href={finding.href} prefetch={false} className="group min-w-0">
                    {body}
                  </Link>
                ) : (
                  <a
                    href={finding.href}
                    target="_blank"
                    rel="noreferrer noopener"
                    className="group min-w-0"
                  >
                    {body}
                  </a>
                )
              ) : (
                <span className="min-w-0">{body}</span>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
