/** Settled public profiles are eligible for at most two normal refreshes per day. */
export const AUTOMATIC_REFRESH_INTERVAL_MS = 12 * 60 * 60 * 1_000;

/** New profiles receive enough history for the normal Rival IQ-style windows. */
export const AUTOMATIC_REFRESH_HISTORY_DAYS = 90;
