/**
 * Detect follower readings a source already rounded before we saw them.
 *
 * Facebook page counts arrive pre-rounded at scale. Boston 25 News read
 * 1,300,000 every day through 9 August and 1,400,000 every day after, with no
 * intermediate value: their real count crossed a bucket boundary and the
 * reported figure snapped, booking a phantom +100,000 in a single week. Of 535
 * Facebook readings above 500k in one fortnight, 531 were round thousands and
 * only 4 were precise.
 *
 * The level is still roughly right, so we keep showing it. The CHANGE is what
 * breaks: it reads zero for weeks and then fires a six-figure jump the moment
 * a bucket flips, and a reader has no way to tell that from real growth. This
 * module supplies the signal that lets the UI say so.
 *
 * Deliberately not a suppression rule. A rounded reading is still evidence,
 * and hiding the number would trade one kind of dishonesty for another.
 */

/** Largest power-of-ten step a value sits on, capped so 0 is not infinite. */
export function roundingStep(value: number): number {
  if (!Number.isFinite(value) || value <= 0) return 1;
  if (!Number.isInteger(value)) return 1;
  let step = 1;
  // Stop at 1e6: beyond that the value itself is the only evidence left.
  while (step <= 1_000_000 && value % (step * 10) === 0) step *= 10;
  return step;
}

/**
 * Precision of a reading as a fraction of its own size.
 *
 * 1,400,000 rounded to 100,000 is 7.1% precision, which cannot support a
 * weekly delta of a few thousand. 34,700 rounded to 100 is 0.3%, which can.
 */
export function readingPrecision(value: number): number {
  if (!Number.isFinite(value) || value <= 0) return 0;
  return roundingStep(value) / value;
}

/**
 * True when a change between two readings is dominated by source rounding.
 *
 * The test is whether the rounding step is large enough to have produced the
 * movement on its own. A single bucket flip yields exactly one step, so any
 * change no larger than the step is indistinguishable from an artifact.
 */
export function changeIsRounded(first: number | null, last: number | null): boolean {
  if (first === null || last === null) return false;
  if (!Number.isFinite(first) || !Number.isFinite(last)) return false;
  /*
   * The FINEST of the two steps, not the coarsest. A value can be divisible by
   * a larger power than the grid it was rounded to purely by coincidence:
   * 2,000,000 divides by a million, but if the source rounds to 100k then a
   * move from 1,300,000 is seven real buckets, not one artifact. Taking the
   * minimum keeps that honest and only flags moves the grid could have made.
   */
  const step = Math.min(roundingStep(first), roundingStep(last));
  // A coarse step on a big number is the tell; sub-1% precision is fine.
  const coarse = Math.min(readingPrecision(first), readingPrecision(last)) >= 0.01;
  if (!coarse) return false;
  const change = Math.abs(last - first);
  return change === 0 || change <= step;
}
