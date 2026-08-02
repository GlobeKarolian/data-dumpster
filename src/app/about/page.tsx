import type { Metadata } from 'next';
import Link from 'next/link';
import { DumpsterLogo } from '@/components/shell/logo';

export const metadata: Metadata = {
  title: 'About',
  description:
    'Data Dumpster is a social media analytics service operated by Boston Globe Media Partners, LLC.',
  alternates: { canonical: 'https://pressbox-kappa.vercel.app/about' },
  robots: { index: true, follow: true },
};

export default function AboutPage() {
  return (
    <main className="min-h-dvh bg-white text-zinc-950 dark:bg-zinc-950 dark:text-zinc-50">
      <header className="border-b border-zinc-200 dark:border-zinc-800">
        <div className="mx-auto flex h-16 max-w-3xl items-center justify-between px-6">
          <DumpsterLogo />
          <Link
            href="/login"
            className="rounded-md border border-zinc-300 px-3 py-2 text-sm font-semibold dark:border-zinc-700"
          >
            Sign in
          </Link>
        </div>
      </header>

      <article className="mx-auto max-w-3xl px-6 py-16 sm:py-24">
        <p className="text-xs font-semibold uppercase tracking-[0.16em] text-accent-700 dark:text-accent-400">
          A Boston Globe Media product
        </p>
        <h1 className="mt-4 text-4xl font-semibold tracking-tight sm:text-5xl">Data Dumpster</h1>
        <p className="mt-6 text-lg leading-8 text-zinc-600 dark:text-zinc-300">
          Data Dumpster is a social media analytics service for news organizations. It is operated
          by Boston Globe Media Partners, LLC. The service turns public social account and post data
          into competitive benchmarks, rankings, reports and alerts.
        </p>

        <section className="mt-14 border-t border-zinc-200 pt-10 dark:border-zinc-800">
          <h2 className="text-2xl font-semibold tracking-tight">How we use Facebook Platform Data</h2>
          <p className="mt-4 leading-7 text-zinc-600 dark:text-zinc-300">
            Customers select the public Facebook Pages they want to compare. Data Dumpster uses
            available public Page information, including follower totals, public posts, reactions,
            comments and shares, to evaluate public-content performance and help news organizations
            plan their social strategy.
          </p>
          <p className="mt-4 leading-7 text-zinc-600 dark:text-zinc-300">
            We do not access private profiles or messages. We do not use Platform Data for
            advertising or individual profiling. Data from an owned Page is accessed only after an
            authorized customer connects it.
          </p>
        </section>

        <section id="privacy" className="mt-14 border-t border-zinc-200 pt-10 dark:border-zinc-800">
          <h2 className="text-2xl font-semibold tracking-tight">Privacy and data deletion</h2>
          <p className="mt-4 leading-7 text-zinc-600 dark:text-zinc-300">
            Data Dumpster uses organization-scoped accounts and encrypted platform credentials.
            For privacy questions or to request deletion of a Data Dumpster account or an authorized
            Meta connection, email{' '}
            <a className="font-semibold underline" href="mailto:Matt.Karolian@globe.com">
              Matt.Karolian@globe.com
            </a>{' '}
            and identify Data Dumpster in the request.
          </p>
          <p className="mt-4 leading-7 text-zinc-600 dark:text-zinc-300">
            See the{' '}
            <a
              className="font-semibold underline"
              href="https://www.bostonglobe.com/about/help/privacy-policy/"
              target="_blank"
              rel="noreferrer"
            >
              Boston Globe privacy policy
            </a>{' '}
            for retention, security and privacy-rights information.
          </p>
        </section>

        <section className="mt-14 border-t border-zinc-200 pt-10 text-sm leading-6 text-zinc-500 dark:border-zinc-800 dark:text-zinc-400">
          <p className="font-semibold text-zinc-800 dark:text-zinc-200">
            Boston Globe Media Partners, LLC
          </p>
          <p>One Exchange Place, Boston, Massachusetts 02109</p>
          <p className="mt-3">
            <a className="underline" href="https://www.bostonglobemedia.com/about/">
              About Boston Globe Media
            </a>{' '}
            ·{' '}
            <a className="underline" href="https://www.bostonglobemedia.com/contact/">
              Contact
            </a>
          </p>
        </section>
      </article>
    </main>
  );
}
