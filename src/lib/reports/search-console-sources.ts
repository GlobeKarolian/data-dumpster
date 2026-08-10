export type SearchTableId = 'globeSearch' | 'bostonSearch';

/** Human-auditable source reports. Credentials are deliberately kept elsewhere. */
export const SEARCH_DASHBOARDS: Record<SearchTableId, { label: string; url: string }> = {
  globeSearch: {
    label: 'Globe.com Search Console dashboard',
    url: 'https://datastudio.google.com/u/0/reporting/bee9d7b7-6f7b-44d8-81bf-7232c2e9d4e8/page/qOVwC',
  },
  bostonSearch: {
    label: 'Boston.com Search Console dashboard',
    url: 'https://datastudio.google.com/u/0/reporting/95f92bb2-d6c9-446c-b0c4-99c830531fe4/page/qOVwC',
  },
};

const LOOKER_HOSTS = new Set(['datastudio.google.com', 'lookerstudio.google.com']);
const REPORT_PATH = /\/reporting\/([a-z0-9-]+)\/page\/([a-z0-9_-]+)/i;

export type SearchDashboardReference = {
  url: string;
  reportId: string;
  pageId: string;
};

/**
 * Validate and normalize a user-supplied Looker Studio report URL.
 *
 * The URL is an audit/configuration reference; automated query data still
 * comes from the sanctioned Search Console API. Accepting only Google's two
 * Looker hosts prevents a public report from becoming an arbitrary-link host.
 */
export function parseSearchDashboardUrl(value: string): SearchDashboardReference | null {
  let parsed: URL;
  try {
    parsed = new URL(value.trim());
  } catch {
    return null;
  }
  if (parsed.protocol !== 'https:' || !LOOKER_HOSTS.has(parsed.hostname.toLowerCase())) return null;
  const match = parsed.pathname.match(REPORT_PATH);
  if (!match) return null;
  parsed.hash = '';
  return { url: parsed.toString(), reportId: match[1], pageId: match[2] };
}

export function sourceUrlFor(
  id: SearchTableId,
  configured: string | undefined,
): string {
  return parseSearchDashboardUrl(configured ?? '')?.url ?? SEARCH_DASHBOARDS[id].url;
}
