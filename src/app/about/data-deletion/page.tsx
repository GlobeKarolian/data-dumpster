import type { Metadata } from 'next';
import {
  DocumentList,
  DocumentSection,
  PublicDocument,
} from '../_components/public-document';

export const metadata: Metadata = {
  title: 'Data deletion instructions',
  description: 'How to request deletion of a Data Dumpster account or connected Meta data.',
  alternates: { canonical: 'https://pressbox-kappa.vercel.app/about/data-deletion' },
  robots: { index: true, follow: true },
};

export default function DataDeletionPage() {
  return (
    <PublicDocument
      eyebrow="Data Dumpster policy"
      title="Data deletion instructions"
      summary="You can request deletion of your Data Dumpster account, organization-private data or an authorized Meta connection."
      effectiveDate="August 3, 2026"
    >
      <DocumentSection title="Submit a request">
        <p>
          Email{' '}
          <a className="font-semibold underline underline-offset-4" href="mailto:Matt.Karolian@globe.com?subject=Data%20Dumpster%20data%20deletion">
            Matt.Karolian@globe.com
          </a>{' '}
          with the subject <strong className="text-zinc-900 dark:text-zinc-100">Data Dumpster data deletion</strong>.
          Include:
        </p>
        <DocumentList>
          <li>Your name and the email address used for Data Dumpster.</li>
          <li>Your organization.</li>
          <li>Whether you want the account, a connected Meta authorization, or both deleted.</li>
          <li>The Facebook Page or Instagram account involved, if the request concerns a connection.</li>
        </DocumentList>
        <p>
          Do not send a password, app secret, access token, refresh token or other credential in the
          request.
        </p>
      </DocumentSection>

      <DocumentSection title="Verification and processing">
        <p>
          We will verify that the requester controls the Data Dumpster account or is authorized to
          act for the organization. After verification, we will process the request as required by
          applicable law and platform terms and provide a completion status or explain any data that
          must be retained.
        </p>
      </DocumentSection>

      <DocumentSection title="What deletion covers">
        <DocumentList>
          <li>The user account and associated organization membership.</li>
          <li>Organization-private settings and content within the scope of the verified request.</li>
          <li>Stored credentials and connection metadata for the authorized Meta connection.</li>
          <li>Scheduled access that depends on the deleted authorization.</li>
        </DocumentList>
        <p>
          Security backups and records required for fraud prevention, audit or legal compliance may
          persist for a limited period. They are not restored to active product use.
        </p>
      </DocumentSection>

      <DocumentSection title="Public social observations">
        <p>
          Public Page and post observations are distinct from a user&apos;s account and authorization.
          They may remain in the pooled public dataset when independently public and needed by
          another authorized customer. Private organization configuration and connected-account
          credentials are never retained on that basis.
        </p>
      </DocumentSection>

      <DocumentSection title="Remove Meta access immediately">
        <p>
          A user can also remove the app from Meta&apos;s Apps and Websites settings or revoke the
          applicable business integration. That stops future authorized access from that grant. Send
          the deletion request above as well so Data Dumpster can remove the corresponding local
          connection and account-specific records.
        </p>
      </DocumentSection>
    </PublicDocument>
  );
}
