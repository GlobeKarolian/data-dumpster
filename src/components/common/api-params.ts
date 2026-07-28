/**
 * The URL the user sees and the URL the API expects are deliberately different.
 *
 * Screen URLs are short and human ("companies=", "tags=", "q=") because people
 * paste them into Slack. The analytics API speaks the contract's vocabulary
 * ("companyIds=", "tagIds=", "search="). This is the one place that translates,
 * so no component has to know both dialects.
 */
const RENAME: Record<string, string> = {
  companies: 'companyIds',
  tags: 'tagIds',
  types: 'postTypes',
  q: 'search',
};

/** Screen params that never belong on an API request. */
const DROP = new Set(['landscape', 'groupBy', 'view']);

export function toApiParams(
  screen: URLSearchParams,
  landscapeId: string,
  extra?: Record<string, string | number | undefined>,
): URLSearchParams {
  const out = new URLSearchParams();
  out.set('landscapeId', landscapeId);

  for (const [key, value] of screen.entries()) {
    if (DROP.has(key) || !value) continue;
    out.set(RENAME[key] ?? key, value);
  }

  for (const [key, value] of Object.entries(extra ?? {})) {
    if (value === undefined) continue;
    out.set(key, String(value));
  }

  return out;
}

export function apiUrl(
  path: string,
  screen: URLSearchParams,
  landscapeId: string,
  extra?: Record<string, string | number | undefined>,
): string {
  return path + '?' + toApiParams(screen, landscapeId, extra).toString();
}
