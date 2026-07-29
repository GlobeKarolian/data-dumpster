import * as React from 'react';
import Link from 'next/link';
import { Building2, Radio, Sparkles, Target } from 'lucide-react';
import { Card } from '@/components/ui/card';

const STEPS = [
  {
    icon: Building2,
    title: 'Add the companies',
    body: 'Your brand and the outlets you actually compete with for attention. Metro dailies, national desks, public radio, local upstarts.',
    href: '/settings/companies',
    cta: 'Add companies',
  },
  {
    icon: Target,
    title: 'Group them into a landscape',
    body: 'A landscape is one focus company plus its rivals. Every screen in Data Dumpster answers a question about one landscape over one window.',
    href: '/settings/companies',
    cta: 'Create a landscape',
  },
  {
    icon: Radio,
    title: 'Connect the channels',
    body: 'Paste a handle or a profile URL for each platform. Data Dumpster reads public data on a schedule and stores the history so deltas stay honest.',
    href: '/settings/sources',
    cta: 'Connect channels',
  },
  {
    icon: Sparkles,
    title: 'Point it at your own model',
    body: 'Briefs and answers run on inference your organization controls. Nothing leaves for a vendor the newsroom did not choose.',
    href: '/settings/models',
    cta: 'Configure a model',
  },
];

/**
 * First run. The database is empty on the day this product is first opened, so
 * the empty state is the first impression: it should read as a setup checklist,
 * not as a broken dashboard.
 */
export function NoLandscape({ reason }: { reason?: string | null }) {
  return (
    <div className="mx-auto max-w-3xl py-8">
      <p className="text-xs font-semibold uppercase tracking-[0.16em] text-accent-600">Set up Data Dumpster</p>
      <h2 className="mt-2 text-xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
        There is no landscape to compare yet.
      </h2>
      <p className="mt-2 max-w-xl text-sm leading-relaxed text-zinc-600 dark:text-zinc-400">
        Data Dumpster measures one competitive set at a time. Four steps stand between an empty database
        and a screen that can settle an argument in a Monday meeting.
      </p>
      {reason ? (
        <p className="mt-3 rounded-md border border-amber-300/60 bg-amber-50 px-3 py-2 text-xs leading-relaxed text-amber-800 dark:border-amber-900/50 dark:bg-amber-950/30 dark:text-amber-300">
          {'The landscape list could not be read: ' + reason}
        </p>
      ) : null}

      <ol className="mt-6 grid gap-3 sm:grid-cols-2">
        {STEPS.map((step, i) => (
          <li key={step.title}>
            <Card className="h-full p-4">
              <div className="flex items-start gap-3">
                <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md border border-zinc-200 bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-900">
                  <step.icon className="h-3.5 w-3.5 text-zinc-500" strokeWidth={1.75} aria-hidden />
                </span>
                <div className="min-w-0">
                  <p className="pb-num text-[10px] font-semibold uppercase tracking-wider text-zinc-400">
                    {'Step ' + (i + 1)}
                  </p>
                  <h3 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">{step.title}</h3>
                  <p className="mt-1 text-xs leading-relaxed text-zinc-500 dark:text-zinc-400">{step.body}</p>
                  <Link
                    href={step.href}
                    className="mt-2 inline-flex text-xs font-medium text-accent-600 hover:underline dark:text-accent-500"
                  >
                    {step.cta}
                  </Link>
                </div>
              </div>
            </Card>
          </li>
        ))}
      </ol>
    </div>
  );
}
