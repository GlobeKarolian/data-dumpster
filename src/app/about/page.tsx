import type { Metadata } from 'next';
import Link from 'next/link';
import {
  DocumentList,
  DocumentSection,
  PublicDocument,
} from './_components/public-document';

export const metadata: Metadata = {
  title: 'About',
  description:
    'Data Dumpster is a social media analytics service operated by Boston Globe Media Partners, LLC.',
  alternates: { canonical: 'https://pressbox-kappa.vercel.app/about' },
  robots: { index: true, follow: true },
};

export default function AboutPage() {
  return (
    <PublicDocument
      eyebrow="A Boston Globe Media product"
      title="Data Dumpster"
      summary="Competitive social intelligence for news organizations, with explicit metric definitions, auditable AI claims and source-aware coverage."
    >
      <DocumentSection title="What the service does">
        <p>
          Data Dumpster is operated by Boston Globe Media Partners, LLC. It turns public social
          account and post data into competitive benchmarks, rankings, reports and alerts for
          authorized newsroom teams.
        </p>
        <DocumentList>
          <li>Compare public account growth, publishing activity and post engagement.</li>
          <li>Inspect the posts and topics that drove a result.</li>
          <li>Build reports and alerts from metric definitions that remain visible in the product.</li>
          <li>Use an organization&apos;s chosen AI provider only against code-computed fact sheets.</li>
        </DocumentList>
      </DocumentSection>

      <DocumentSection title="How we use Meta Platform Data">
        <p>
            Customers select the public Facebook Pages they want to compare. Data Dumpster uses
            available public Page information, including follower totals, public posts, reactions,
            comments and shares, to evaluate public-content performance and help news organizations
            plan their social strategy.
        </p>
        <p>
            We do not access private profiles or messages. We do not use Platform Data for
            advertising or individual profiling. Data from an owned Page is accessed only after an
            authorized customer connects it.
        </p>
      </DocumentSection>

      <DocumentSection title="Public data, private boundaries">
        <p>
          Public company, channel and post observations can be reused across customer landscapes
          because the underlying public facts are the same. Customer accounts, landscape choices,
          tags, dashboards, briefs, reports and credentials remain private to the organization that
          created them. Platform credentials are encrypted at rest.
        </p>
      </DocumentSection>

      <DocumentSection title="Policies and requests">
        <div className="grid gap-3 sm:grid-cols-3">
          <Link
            href="/about/privacy"
            className="rounded-lg border border-zinc-200 p-4 font-semibold text-zinc-900 transition-colors hover:bg-zinc-50 dark:border-zinc-800 dark:text-zinc-100 dark:hover:bg-zinc-900"
          >
            Privacy policy
          </Link>
          <Link
            href="/about/data-deletion"
            className="rounded-lg border border-zinc-200 p-4 font-semibold text-zinc-900 transition-colors hover:bg-zinc-50 dark:border-zinc-800 dark:text-zinc-100 dark:hover:bg-zinc-900"
          >
            Data deletion
          </Link>
          <Link
            href="/about/terms"
            className="rounded-lg border border-zinc-200 p-4 font-semibold text-zinc-900 transition-colors hover:bg-zinc-50 dark:border-zinc-800 dark:text-zinc-100 dark:hover:bg-zinc-900"
          >
            Terms of service
          </Link>
        </div>
      </DocumentSection>
    </PublicDocument>
  );
}
