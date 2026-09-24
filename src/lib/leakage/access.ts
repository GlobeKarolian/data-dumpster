/**
 * Article Leakage is a named-user capability, like manual refresh: it spends
 * X API credits and lists individual accounts, so it is limited to the people
 * below rather than a role. The API checks again; the shell flag only hides
 * the sidebar item. Everyone else gets a 404, not a 403, so the feature does
 * not advertise itself.
 */
const LEAKAGE_EMAILS = new Set([
  'matt.karolian@globe.com',
  'matt@boston.com',
]);

export function canUseLeakage(email: string | null | undefined): boolean {
  return LEAKAGE_EMAILS.has(email?.trim().toLowerCase() ?? '');
}
