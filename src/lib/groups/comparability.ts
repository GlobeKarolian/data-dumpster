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

/**
 * Read a timestamp that crossed the database boundary as epoch milliseconds.
 *
 * Timestamps used to come across as `::text`, which yields
 * "2018-07-07 14:23:00+00", and the parser swapped the space for a T and
 * appended a Z, appending an offset to a string that already had one. Every
 * coverage read returned null, silently, so the comparability guard below never
 * fired once in production and every delta on the screen read n/a. Epoch
 * milliseconds have no format left to get wrong.
 */
export function fromEpochMs(v: string | number | null | undefined): Date | null {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? new Date(n) : null;
}

/** Previous window of equal length, for period-over-period deltas. */
export function priorWindow(w: GroupWindow): GroupWindow {
  const span = w.end.getTime() - w.start.getTime();
  return { start: new Date(w.start.getTime() - span), end: new Date(w.start.getTime()) };
}

/**
 * True only when the window and the equal-length window before it both sit
 * inside what we collected. One day of slack at the leading edge, because
 * collection lands a few hours behind the clock even when it is healthy.
 *
 * This checks the edges only. A window can pass this and still have a hole in
 * the middle, which is what `windowIsFullyCollected` is for.
 */
export function windowIsComparable(w: GroupWindow, c: GroupCoverage): boolean {
  if (!c.firstPost || !c.lastPost) return false;
  const prior = priorWindow(w);
  return c.lastPost.getTime() >= w.end.getTime() - DAY_MS
    && c.firstPost.getTime() <= prior.start.getTime();
}

/** Whole days a window spans, which is what a per-day count is measured against. */
export function daysInWindow(w: GroupWindow): number {
  return Math.max(1, Math.round((w.end.getTime() - w.start.getTime()) / DAY_MS));
}

/**
 * Did we collect every day of this window, or only its ends.
 *
 * The edge check alone is not enough, and the four days this collector spent
 * paused are the proof: collection resumed, the leading edge was fresh again,
 * the guard said comparable, and the page reported neighborhood chatter down 34
 * percent. It was not down. We were not looking.
 *
 * Days carrying posts stand in for days collected, which is sound for
 * communities that produce 50 to 110 posts every day of the week: a day with
 * none of them means we missed it, not that Somerville fell silent. One day of
 * slack for the day still in progress.
 */
export function windowIsFullyCollected(w: GroupWindow, daysWithPosts: number): boolean {
  return daysWithPosts >= daysInWindow(w) - 1;
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
