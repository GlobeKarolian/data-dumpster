import type { Metadata } from 'next';
import Link from 'next/link';
import {
  DocumentList,
  DocumentSection,
  PublicDocument,
} from '../_components/public-document';

export const metadata: Metadata = {
  title: 'Terms of service',
  description: 'Terms governing authorized use of Data Dumpster.',
  alternates: { canonical: 'https://pressbox-kappa.vercel.app/about/terms' },
  robots: { index: true, follow: true },
};

export default function TermsPage() {
  return (
    <PublicDocument
      eyebrow="Data Dumpster policy"
      title="Terms of service"
      summary="These terms govern authorized use of Data Dumpster, a Boston Globe Media Partners, LLC social media analytics service."
      effectiveDate="August 3, 2026"
    >
      <DocumentSection title="Authorized use">
        <p>
          Data Dumpster is provided to approved users acting for a participating organization. Users
          must provide accurate account information, follow their organization&apos;s policies and use the
          service only for legitimate social media measurement, reporting and editorial or business
          planning.
        </p>
      </DocumentSection>

      <DocumentSection title="User responsibilities">
        <DocumentList>
          <li>Protect sign-in and connected-platform credentials.</li>
          <li>Connect only accounts and assets you are authorized to administer.</li>
          <li>Follow applicable laws and the terms of each source platform.</li>
          <li>Review source coverage and metric definitions before relying on an output.</li>
          <li>Report suspected unauthorized access or credential exposure promptly.</li>
        </DocumentList>
      </DocumentSection>

      <DocumentSection title="Prohibited use">
        <p>Users may not use Data Dumpster to:</p>
        <DocumentList>
          <li>Access private profiles, messages or data they are not authorized to access.</li>
          <li>Conduct unlawful surveillance, harassment or individual advertising profiling.</li>
          <li>Resell Platform Data or use it to build an unrelated data product.</li>
          <li>Circumvent source-platform controls, product access controls or usage limits.</li>
          <li>Interfere with the service, test its security without authorization or introduce harmful code.</li>
        </DocumentList>
      </DocumentSection>

      <DocumentSection title="Data sources and limitations">
        <p>
          Data Dumpster combines data made available by social platforms and approved providers.
          Coverage, field availability and update frequency differ by platform and can change without
          notice. The product identifies material source limits and does not promise that public data
          is complete, uninterrupted or equivalent to a platform&apos;s private owned-account analytics.
        </p>
      </DocumentSection>

      <DocumentSection title="Reports and AI-assisted analysis">
        <p>
          Reports and AI-assisted explanations support human analysis; they do not replace editorial,
          legal, financial or business judgment. Data Dumpster constrains numerical AI claims to
          code-computed fact sheets, but users remain responsible for reviewing context, source
          coverage and the final use of any output.
        </p>
      </DocumentSection>

      <DocumentSection title="Access, changes and suspension">
        <p>
          Boston Globe Media Partners may update the service, correct data, change source coverage or
          suspend access to protect users, platforms or the service. Access may be removed when a user
          leaves an organization, violates these terms or no longer has authorization for a connected
          asset.
        </p>
      </DocumentSection>

      <DocumentSection title="Privacy and deletion">
        <p>
          Use of Data Dumpster is also subject to the{' '}
          <Link className="font-semibold underline underline-offset-4" href="/about/privacy">
            Data Dumpster privacy policy
          </Link>. Instructions for deleting an account or authorized Meta connection are available on
          the{' '}
          <Link className="font-semibold underline underline-offset-4" href="/about/data-deletion">
            data-deletion page
          </Link>.
        </p>
      </DocumentSection>

      <DocumentSection title="Contact">
        <p>
          Questions about these terms may be sent to{' '}
          <a className="font-semibold underline underline-offset-4" href="mailto:Matt.Karolian@globe.com">
            Matt.Karolian@globe.com
          </a>{' '}
          with Data Dumpster in the subject line.
        </p>
      </DocumentSection>
    </PublicDocument>
  );
}
