/**
 * Reading a story's arc.
 *
 * A tag's series answers the question nobody could answer before: is this
 * story still worth staffing? The arc is read from engagement rather than
 * volume, because volume measures what a newsroom did and engagement measures
 * whether anyone was still there for it.
 *
 * Everything here is deterministic and tested without a database. The phrasing
 * is deliberately cautious: a story is only called fading when the decline is
 * large enough to survive the noise of a single quiet day, and a window with
 * too few buckets gets no verdict at all rather than a confident guess.
 */

export interface LifecyclePoint {
  /** Report-zone bucket key, e.g. 2026-08-14. */
  date: string;
  posts: number;
  engagement: number;
}

export type LifecyclePhase = 'building' | 'peaking' | 'cresting' | 'fading' | 'flat' | 'unknown';

export interface LifecycleReading {
  phase: LifecyclePhase;
  /** Bucket that earned the most engagement. */
  peakDate: string | null;
  peakEngagement: number;
  /** Most recent bucket's engagement as a share of the peak, 0-1. */
  shareOfPeak: number | null;
  totalPosts: number;
  totalEngagement: number;
  /** One sentence an editor can act on. */
  summary: string;
}

/** Below this many buckets a shape is not a shape. */
const MIN_BUCKETS = 4;
/**
 * Trailing buckets excluded from the verdict because their engagement has not
 * finished accruing.
 *
 * This is the difference between a finding and an artifact. A post published
 * two hours ago has collected almost none of the reaction it will eventually
 * earn, so the newest bucket of EVERY story is near-zero. Reading the phase
 * from it declared all 51 tags faded on the first live run, including stories
 * that were plainly at their peak. The
 * immature buckets are still drawn, because the volume in them is real; they
 * are simply not allowed to decide whether a story is over.
 */
const MATURING_BUCKETS = 2;
/** Tail is read from this many trailing buckets, so one quiet day cannot swing it. */
const TAIL = 3;
/** A decline shallower than this is noise, not a fade. */
const FADE_CEILING = 0.5;
/** Sustained reaction near the peak is cresting rather than fading. */
const CREST_FLOOR = 0.8;

function sum(values: number[]): number {
  return values.reduce((a, b) => a + b, 0);
}

function mean(values: number[]): number {
  return values.length === 0 ? 0 : sum(values) / values.length;
}

/**
 * Read the arc.
 *
 * The comparison is trailing-mean against the peak rather than last-bucket
 * against peak, because the last bucket of any window is usually partial and
 * would make every live story look dead.
 */
export function readLifecycle(
  points: LifecyclePoint[],
  options: { maturingBuckets?: number } = {},
): LifecycleReading {
  // Totals cover everything collected; only the VERDICT ignores immature buckets.
  const totalPosts = sum(points.map((p) => p.posts));
  const totalEngagement = sum(points.map((p) => p.engagement));
  const empty: LifecycleReading = {
    phase: 'unknown',
    peakDate: null,
    peakEngagement: 0,
    shareOfPeak: null,
    totalPosts,
    totalEngagement,
    summary: 'Not enough of a window to read a shape.',
  };

  const maturing = Math.max(0, options.maturingBuckets ?? MATURING_BUCKETS);
  const judged = maturing > 0 && points.length > maturing
    ? points.slice(0, points.length - maturing)
    : points;
  if (judged.length < MIN_BUCKETS) return empty;

  const peak = judged.reduce((a, b) => (b.engagement > a.engagement ? b : a));
  if (peak.engagement <= 0) {
    return { ...empty, summary: 'No measured reaction in this window.' };
  }

  const peakIndex = judged.findIndex((p) => p.date === peak.date);
  const tail = judged.slice(-TAIL);
  const tailMean = mean(tail.map((p) => p.engagement));
  const shareOfPeak = tailMean / peak.engagement;

  /*
   * A "still publishing after the audience left" claim is deliberately absent.
   * It needs post volume compared across buckets, and volume here counts
   * TAGGED posts — while the backfill drains newest-first, recent buckets have
   * better tag coverage than older ones, so flat output looks like rising
   * output and the accusation fires on almost every story. Engagement-shape
   * claims are unaffected (better coverage of recent posts can only make a
   * fade look smaller, so calling one is conservative). The volume claim
   * returns when per-bucket coverage is measured and even.
   */
  /*
   * When the high point IS the latest bucket, the story is peaking, full
   * stop. Judging that case by the trailing mean would penalise exactly the
   * shape we care most about: a story climbing steeply, whose ramp-up drags
   * its own three-bucket average below its current height.
   */
  const peakIsNow = peakIndex === judged.length - 1;
  const peakIsRecent = peakIndex >= judged.length - TAIL;
  const phase: LifecyclePhase = peakIsNow
    ? 'peaking'
    : peakIsRecent
      ? (shareOfPeak >= CREST_FLOOR ? 'peaking' : 'cresting')
      : shareOfPeak >= CREST_FLOOR
        ? 'cresting'
        : shareOfPeak < FADE_CEILING
          ? 'fading'
          : 'flat';

  const pct = Math.round(shareOfPeak * 100);
  const summary = ((): string => {
    switch (phase) {
      case 'peaking':
        return `Peaking now, at ${peak.date}. Reaction is at its highest of the window.`;
      case 'cresting':
        return `Still holding at ${pct}% of its ${peak.date} peak.`;
      case 'fading':
        return `Faded to ${pct}% of its ${peak.date} peak.`;
      default:
        return `Steady, without a decisive peak.`;
    }
  })();

  return {
    phase,
    peakDate: peak.date,
    peakEngagement: peak.engagement,
    shareOfPeak,
    totalPosts,
    totalEngagement,
    summary,
  };
}

/** Sort key for surfacing: live stories first, then by the reaction they earned. */
export function lifecycleRank(reading: LifecycleReading): number {
  const phaseWeight: Record<LifecyclePhase, number> = {
    peaking: 4, cresting: 3, flat: 2, fading: 1, building: 2, unknown: 0,
  };
  return phaseWeight[reading.phase] * 1e12 + reading.totalEngagement;
}
