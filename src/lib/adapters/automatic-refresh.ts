/** Settled public profiles are eligible for at most two normal refreshes per day. */
export const AUTOMATIC_REFRESH_INTERVAL_MS = 12 * 60 * 60 * 1_000;

/**
 * Automatic collection is scheduled at midnight and noon UTC. Reuse work from
 * the current fixed window rather than measuring twelve hours from the prior
 * worker's actual start time. A midnight run that starts at 00:01 must never
 * make the following noon run look one minute too early.
 */
export function automaticRefreshWindowStart(now: Date): Date {
  return new Date(
    Math.floor(now.getTime() / AUTOMATIC_REFRESH_INTERVAL_MS)
      * AUTOMATIC_REFRESH_INTERVAL_MS,
  );
}

/** New profiles receive enough history for the normal Rival IQ-style windows. */
export const AUTOMATIC_REFRESH_HISTORY_DAYS = 90;
