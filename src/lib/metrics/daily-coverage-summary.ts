/** Pure coverage math shared by the monitor and its regression tests. */
export function summarizeDailyCoverage(
  expectedChannels: number,
  observedChannels: number,
): { ratio: number; complete: boolean } {
  // No expected channels means collection was not scheduled that day. It is
  // neither a success nor a failure, and must never paint a green square.
  if (expectedChannels <= 0) return { ratio: 0, complete: false };
  const ratio = Math.max(0, Math.min(1, observedChannels / expectedChannels));
  // 98% rather than 100%: a handful of channels can be legitimately
  // unavailable on a day, and a monitor that can never go green gets ignored.
  return { ratio, complete: ratio >= 0.98 };
}

/**
 * Only a scheduled, closed collection day can be a monitoring failure.
 *
 * `complete: false` also represents the deliberately neutral "not scheduled"
 * state. Keeping that distinction here prevents health checks from paging on
 * dates before the first landscape demand existed.
 */
export function isScheduledCoverageFailure(day: {
  activeChannels: number;
  complete: boolean;
}): boolean {
  return day.activeChannels > 0 && !day.complete;
}
