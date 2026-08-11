const MANUAL_REFRESH_EMAILS = new Set([
  'matt.karolian@globe.com',
  'matt@boston.com',
]);

/**
 * Manual collection spends paid vendor units, so it is an explicit named-user
 * capability rather than a general editor permission. The API applies this
 * check again; the boolean sent to the shell only controls what the UI shows.
 */
export function canTriggerManualRefresh(email: string | null | undefined): boolean {
  return MANUAL_REFRESH_EMAILS.has(email?.trim().toLowerCase() ?? '');
}
