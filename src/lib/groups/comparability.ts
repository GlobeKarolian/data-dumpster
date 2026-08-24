/**
 * Whether a group-view window may be compared to the one before it.
 *
 * Group collection runs on its own schedule and has been paused for stretches,
 * so a seven-day window can contain four days we read and three we never did.
 * Days we never read come back as no rows, which is indistinguishable from a
 * quiet weekend unless something checks. Without this check, pausing the
 * collector reads on screen as Greater Boston going quiet, which is the exact
 * class of confident-but-wrong statement this product must not make.
 *
 * Kept separate from the query layer so it can be tested without a database.
 */

export interface GroupWindow {
  start: Date;
  end: Date;
}

/** The span we have actually collected, whatever span the reader asked for. */
export interface GroupCoverage {
  firstPost: Date | null;
  lastPost: Date | null;
}

const DAY_MS = 24 * 60 * 60 * 1000;

/** Previous window of equal length, for period-over-period deltas. */
export function priorWindow(w: GroupWindow): GroupWindow {
  const span = w.end.getTime() - w.start.getTime();
  return { start: new Date(w.start.getTime() - span), end: new Date(w.start.getTime()) };
}

/**
 * True only when the window and the equal-length window before it both sit
 * inside what we collected. One day of slack at the leading edge, because
 * collection lands a few hours behind the clock even when it is healthy.
 */
export function windowIsComparable(w: GroupWindow, c: GroupCoverage): boolean {
  if (!c.firstPost || !c.lastPost) return false;
  const prior = priorWindow(w);
  return c.lastPost.getTime() >= w.end.getTime() - DAY_MS
    && c.firstPost.getTime() <= prior.start.getTime();
}

/**
 * Period-over-period change as a fraction, because every formatter downstream
 * multiplies by 100 itself. Returning a percent here printed ">1000%" on a
 * twelve percent move.
 */
export function changeRatio(current: number, prior: number): number | null {
  if (prior <= 0) return null;
  return (current - prior) / prior;
}
