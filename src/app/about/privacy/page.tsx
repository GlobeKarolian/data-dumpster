import type { Metadata } from 'next';
import Link from 'next/link';
import {
  DocumentList,
  DocumentSection,
  PublicDocument,
} from '../_components/public-document';

export const metadata: Metadata = {
  title: 'Privacy policy',
  description: 'How Data Dumpster collects, uses, protects and deletes data.',
  alternates: { canonical: 'https://pressbox-kappa.vercel.app/about/privacy' },
  robots: { index: true, follow: true },
};

export default function PrivacyPage() {
  return (
    <PublicDocument
      eyebrow="Data Dumpster policy"
      title="Privacy policy"
      summary="This policy explains the information Data Dumpster processes and the boundaries around public social data, customer data and connected-platform credentials."
      effectiveDate="August 3, 2026"
    >
      <DocumentSection title="Who operates Data Dumpster">
        <p>
          Data Dumpster is a social media analytics service operated by Boston Globe Media Partners,
          LLC for authorized news-organization users. This app-specific policy supplements the{' '}
          <a
            className="font-semibold underline underline-offset-4"
            href="https://www.bostonglobe.com/about/help/privacy-policy/"
            target="_blank"
            rel="noreferrer"
          >
            Boston Globe privacy policy
          </a>.
        </p>
      </DocumentSection>

      <DocumentSection title="Information we process">
        <DocumentList>
          <li>
            <strong className="text-zinc-900 dark:text-zinc-100">Account and organization data:</strong>{' '}
            name, email address, role, organization membership, product settings and audit records.
          </li>
          <li>
            <strong className="text-zinc-900 dark:text-zinc-100">Connected-platform data:</strong>{' '}
            account identifiers, granted permissions, connection status and encrypted access or
            refresh credentials supplied by an authorized user.
          </li>
          <li>
            <strong className="text-zinc-900 dark:text-zinc-100">Public social data:</strong>{' '}
            public account identifiers and profile details, follower totals, posts, timestamps,
            captions, media links, public reactions, comments, shares and other public metrics made
            available by a platform or approved data provider.
          </li>
          <li>
            <strong className="text-zinc-900 dark:text-zinc-100">Product activity:</strong>{' '}
            landscapes, tags, dashboards, reports, alerts, delivery settings, prompts and diagnostic
            information needed to operate and secure the service.
          </li>
        </DocumentList>
      </DocumentSection>

      <DocumentSection title="How we use information">
        <DocumentList>
          <li>Provide social performance comparisons, post analysis, reports and alerts.</li>
          <li>Authenticate users, enforce organization boundaries and protect connected accounts.</li>
          <li>Maintain data quality, source coverage, operational reliability and an audit trail.</li>
          <li>Respond to support, privacy, security and data-deletion requests.</li>
          <li>
            Generate optional AI analysis through the model provider chosen by the organization;
            numerical claims are constrained to a code-computed fact sheet.
          </li>
        </DocumentList>
        <p>
          Data Dumpster does not sell Platform Data, use it for advertising, access private Facebook
          profiles or messages, or build individual advertising profiles.
        </p>
      </DocumentSection>

      <DocumentSection title="Meta Platform Data">
        <p>
          Customers select the public Facebook Pages they want to compare. Data Dumpster analyzes
          available public Page profile information, posts and engagement to produce benchmarks,
          rankings, reports and alerts. An owned Page is connected only after an authorized user
          grants the applicable permissions.
        </p>
        <p>
          Data Dumpster uses Meta Platform Data only for the product functions disclosed to the user
          and in accordance with applicable Meta terms and granted permissions.
        </p>
      </DocumentSection>

      <DocumentSection title="Public pooling and customer isolation">
        <p>
          Public company, channel and post observations may be stored once and reused across customer
          landscapes because the public facts do not change based on who is viewing them. Accounts,
          landscape membership, private tags, dashboards, briefs, reports and platform credentials
          are organization-scoped and are not shared between customers.
        </p>
      </DocumentSection>

      <DocumentSection title="Service providers and disclosures">
        <p>
          We may use service providers for hosting, databases, authentication, approved public-data
          collection, report delivery and an organization&apos;s selected AI model. They receive only the
          information needed to perform their contracted function. We may also disclose information
          when required by law, to protect the service and its users, or as part of a corporate
          transaction subject to appropriate safeguards.
        </p>
      </DocumentSection>

      <DocumentSection title="Retention and deletion">
        <p>
          We retain information only as needed to provide, secure and audit the service, satisfy
          platform obligations and meet legal requirements. A verified deletion request removes the
          requesting user&apos;s account data and authorized platform connection, including stored access
          credentials, subject to security backups and records we are legally required to retain.
        </p>
        <p>
          Public social observations may remain in the pooled public dataset when they are
          independently public and still required by another authorized organization. Customer-owned
          configuration and credentials are never retained on that basis. See the{' '}
          <Link className="font-semibold underline underline-offset-4" href="/about/data-deletion">
            data-deletion instructions
          </Link>{' '}
          for how to make a request.
        </p>
      </DocumentSection>

      <DocumentSection title="Security">
        <p>
          Data Dumpster uses authenticated organization-scoped access, encrypted platform
          credentials, least-privilege service configuration, audit records and operational controls
          designed to prevent one customer from accessing another customer&apos;s private data. No system
          can guarantee absolute security; suspected credential exposure should be reported promptly.
        </p>
      </DocumentSection>

      <DocumentSection title="Questions and privacy requests">
        <p>
          Email{' '}
          <a className="font-semibold underline underline-offset-4" href="mailto:Matt.Karolian@globe.com">
            Matt.Karolian@globe.com
          </a>{' '}
          and identify Data Dumpster in the subject line. Do not send passwords, access tokens or
          other secret credentials by email.
        </p>
      </DocumentSection>
    </PublicDocument>
  );
}
