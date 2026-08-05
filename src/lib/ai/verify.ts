/**
 * Deterministic fact-checking of generated prose.
 *
 * This file is the reason a Data Dumpster brief is worth sending to an executive.
 * The prompt asks the model to only restate numbers from the fact sheet; this
 * checks, without a model, whether it did. Every number in the markdown is
 * extracted, normalised, and matched against the numbers the fact sheet
 * actually contains, within the tolerance implied by how the number was
 * written. "1.2M" is allowed to be 1,234,567. It is not allowed to be 900,000.
 *
 * Three checks, all mechanical, all reproducible:
 *   1. Numeric grounding — every figure traces to a fact-sheet path.
 *   2. Runaway percentages — no printed percent change above 1000%, because
 *      those are always a near-zero baseline and always mislead.
 *   3. Caveat coverage — every string in facts.caveats survived into the text.
 *
 * The result is stored with the brief, so months later anyone can see not just
 * what the model said but what was verified at the time it said it.
 */
import type { FactSheet } from '@/lib/metrics/contract';
import {
  availableBreakdownForPrompt,
  PRINTED_PERCENT_CHANGE_GUARDRAILS,
  unavailableMetricField,
} from './prompts';
import { METRIC_DEFS } from '@/lib/metrics/definitions';
import { METRIC_KEYS, type MetricKey } from '@/lib/types';

export interface NumericClaim {
  /** The sentence the number appeared in, trimmed for display. */
  text: string;
  /** The number exactly as the model wrote it, e.g. "1.2M" or "27.3%". */
  raw: string;
  /** Parsed value in fact-sheet units (percentages are also tried as fractions). */
  value: number;
  found: boolean;
  /** Path the model cited in square brackets, when it cited one. */
  citedPath?: string;
  /** Path that actually matched, which may differ from the cited one. */
  matchedPath?: string;
  /** Closest fact-sheet value when nothing matched, so a human can see the miss. */
  nearest?: { path: string; value: number; delta: number };
}

/** Result of checking prose against a closed set of allowed numeric facts. */
export interface NumericGroundingVerification {
  ok: boolean;
  claims: NumericClaim[];
  unverified: string[];
  violations: string[];
  stats: { total: number; grounded: number };
  checkedAt: string;
}

export interface BriefVerification extends NumericGroundingVerification {
  /** True only when every check passed: numbers, percentages, citations, and caveats. */
  ok: boolean;
  /** Caveats from the fact sheet that did not make it into the text. */
  missingCaveats: string[];
  /** Claims that were grounded but cited a path other than the matching one. */
  miscited: string[];
  stats: { total: number; grounded: number; cited: number };
  checkedAt: string;
}

/** Numeric and citation verdict for a short answer over one fact sheet. */
export interface FactSheetAnswerVerification extends NumericGroundingVerification {
  /** Grounded figures whose cited path did not support the claim. */
  miscited: string[];
  stats: { total: number; grounded: number; cited: number };
}

/* --------------------------------------------------------- fact-sheet index */

type NumericUnit = 'number' | 'percent' | 'currency';
type NumericSubject = MetricKey
  | 'engagementRate'
  | 'days'
  | 'rank'
  | 'shareOfPosts'
  | 'lift'
  | 'outlierScore'
  | 'zScore';

export interface NumericSourceEntry {
  path: string;
  value: number;
  /**
   * Every source number is typed so a rank of 5 cannot ground an invented 5%
   * rate. Fact-sheet units are inferred from their metric and field paths.
   */
  unit: NumericUnit;
  /** Whether a percentage value is stored fractionally or as written points. */
  percentRepresentation?: 'display' | 'fraction';
  /** Written precision of rendered material; absent for raw fact-sheet values. */
  tolerance?: number;
  /** What the number measures, used to reject equal-valued but unrelated citations. */
  subject?: NumericSubject;
}

const METRIC_KEY_SET = new Set<string>(METRIC_KEYS);
const DIRECT_PERCENT_FACT_KEYS = new Set([
  'changePct',
  'engagementRateByFollower',
  'engagementRateByView',
  'shareOfPosts',
  'shareOfVoice',
  'shareOfEngagement',
]);
const METRIC_VALUE_FACT_KEYS = new Set([
  'value',
  'previousValue',
  'focusValue',
  'competitorAverage',
  'baseline',
]);

function asMetricKey(value: unknown): MetricKey | undefined {
  return typeof value === 'string' && METRIC_KEY_SET.has(value)
    ? value as MetricKey
    : undefined;
}

function factNumberUnit(
  key: string | undefined,
  metric: MetricKey | undefined,
  insideMetricValues: boolean,
): NumericUnit {
  if (key && DIRECT_PERCENT_FACT_KEYS.has(key)) return 'percent';
  const isMetricValue = insideMetricValues
    || (key !== undefined && METRIC_VALUE_FACT_KEYS.has(key));
  return metric && isMetricValue && METRIC_DEFS[metric].unit === 'percent'
    ? 'percent'
    : 'number';
}

function factNumberSubject(
  key: string | undefined,
  metric: MetricKey | undefined,
  insideMetricValues: boolean,
): NumericSubject | undefined {
  const directMetric = asMetricKey(key);
  if (directMetric) return directMetric;
  if (
    metric
    && (
      insideMetricValues
      || (key !== undefined && METRIC_VALUE_FACT_KEYS.has(key))
      || key === 'changePct'
    )
  ) {
    return metric;
  }
  switch (key) {
    case 'days': return 'days';
    case 'rank': return 'rank';
    case 'postCount': return 'posts';
    case 'followersAtPost': return 'audience';
    case 'medianEngagement': return 'engagementTotal';
    case 'shareOfPosts': return 'shareOfPosts';
    case 'lift': return 'lift';
    case 'outlierScore': return 'outlierScore';
    case 'zScore': return 'zScore';
    default: return undefined;
  }
}

/** Every finite number in the fact sheet, with the path a citation would use. */
export function indexFactNumbers(facts: FactSheet): NumericSourceEntry[] {
  const out: NumericSourceEntry[] = [];
  const seen = new Set<string>();
  const walk = (
    node: unknown,
    path: string,
    key?: string,
    metric?: MetricKey,
    insideMetricValues = false,
  ): void => {
    if (typeof node === 'number') {
      if (Number.isFinite(node)) {
        const dedupe = path + '=' + node;
        if (!seen.has(dedupe)) {
          const unit = factNumberUnit(key, metric, insideMetricValues);
          const subject = factNumberSubject(key, metric, insideMetricValues);
          seen.add(dedupe);
          out.push({
            path,
            value: node,
            unit,
            ...(subject ? { subject } : {}),
            ...(unit === 'percent'
              ? { percentRepresentation: 'fraction' as const }
              : {}),
          });
        }
      }
      return;
    }
    if (Array.isArray(node)) {
      node.forEach((item, i) => (
        walk(item, path + '[' + i + ']', key, metric, insideMetricValues)
      ));
      return;
    }
    if (node && typeof node === 'object') {
      const record = node as Record<string, unknown>;
      const recordMetric = asMetricKey(record.metric) ?? asMetricKey(record.key) ?? metric;
      for (const [k, v] of Object.entries(record)) {
        /*
         * Skip what the prompt suppressed.
         *
         * prompts.ts hides value, rank and changePct on any row with
         * available === false, and previousValue when previousAvailable is
         * false, because an unmeasured row's number is an artefact of a partial
         * ingest rather than a measurement. This index did not skip them, so
         * the set of numbers the verifier would accept was strictly larger than
         * the set the model was ever shown.
         *
         * That is the one gap that matters here. A row with no audience data
         * carries value 0; the model never sees it, but a sentence inventing
         * "flat at 0" matched the index and was certified. The check has to
         * enforce the same honesty rule as the prompt or it certifies nothing.
         */
        if (unavailableMetricField(record, k)) continue;
        const childMetric = asMetricKey(k) ?? recordMetric;
        if (k === 'breakdown') {
          const measured = availableBreakdownForPrompt(record, v);
          if (measured) {
            walk(
              measured,
              path ? path + '.' + k : k,
              k,
              childMetric,
              true,
            );
          }
          continue;
        }
        const childInsideMetricValues = insideMetricValues
          || k === 'spark';
        walk(
          v,
          path ? path + '.' + k : k,
          k,
          childMetric,
          childInsideMetricValues,
        );
      }
    }
  };
  walk(facts, 'facts');
  return out;
}

/* ------------------------------------------------------------- extraction */

const MULTIPLIERS: Record<string, number> = {
  k: 1e3, thousand: 1e3,
  m: 1e6, mm: 1e6, million: 1e6,
  b: 1e9, bn: 1e9, billion: 1e9,
};

/**
 * Numbers as people actually write them: 41,208 / 1.2M / 45k / 27.3% / $3.40 /
 * -12.5 / 2.3 million. The trailing group is optional so bare integers count.
 */
const NUMBER_RE = new RegExp(
  '(?<![\\w.])'
  + '([+\\-\\u2212]?)(\\$?)'
  + '(\\d{1,3}(?:,\\d{3})+(?:\\.\\d+)?|\\d+(?:\\.\\d+)?)'
  + '\\s*'
  + '(%|k\\b|K\\b|MM\\b|M\\b|bn\\b|B\\b|thousand\\b|million\\b|billion\\b)?',
  'g',
);

/*
 * Fact paths use dotted object keys and numeric array indexes. A character
 * class such as `[^\]]*` stops at the first array bracket and truncates a path
 * like facts.leaderboards.posts[0].value. Keep the grammar explicit so the
 * citation extracted for verification is the exact path the prompt rendered.
 */
const FACT_PATH_PATTERN = 'facts(?:\\.[A-Za-z_$][A-Za-z0-9_$]*|\\[\\d+\\])*';

function factCitationPattern(): RegExp {
  return new RegExp('\\[(' + FACT_PATH_PATTERN + ')\\]', 'g');
}

function factCitations(text: string): string[] {
  return Array.from(text.matchAll(factCitationPattern()), (match) => match[1]);
}

const MONTHS = 'jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?'
  + '|aug(?:ust)?|sep(?:t|tember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?';

/** Strip everything that contains digits which are not quantitative claims. */
function stripNonClaims(markdown: string): string {
  return markdown
    // Citations: [facts.leaderboards.engagementTotal[0].value]
    .replace(factCitationPattern(), ' ')
    // Markdown links and images: the URL is not a claim.
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1')
    // Fenced and inline code.
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/`[^`]*`/g, ' ')
    // Dates and years used in explicit temporal phrases are period boundaries,
    // not measurements. A bare year-shaped value can still be a real metric
    // ("2,026 engagements"), so do not discard every 19xx/20xx token.
    .replace(/\d{4}-\d{2}-\d{2}/g, ' ')
    .replace(/\b\d{1,2}\/\d{1,2}\/(?:\d{4}|\d{2})\b/g, ' ')
    .replace(
      /\b(?:in|during|since|through|throughout|until|before|after|by|from)\s+(?:19|20)\d{2}\b(?=\s*(?:[,;:.!?)]|$))/gi,
      ' ',
    )
    .replace(/\b(?:(?:calendar|fiscal)\s+)?year\s+(?:19|20)\d{2}\b/gi, ' ')
    // Clock times.
    .replace(/(?<![\w.])\d{1,2}:\d{2}(?::\d{2})?/g, ' ')
    // Calendar dates written in prose ("July 18", "18 July", "Sept. 3rd").
    // A day of the month is a location in time, not a measurement.
    .replace(new RegExp('\\b(' + MONTHS + ')\\.?\\s+\\d{1,2}(st|nd|rd|th)?\\b', 'gi'), ' ')
    .replace(new RegExp('\\b\\d{1,2}(st|nd|rd|th)?\\s+(' + MONTHS + ')\\b', 'gi'), ' ');
}

type SubjectCue = { subject: NumericSubject; pattern: RegExp };

/*
 * Numeric equality is necessary but not sufficient. Seven days and seven
 * posts are different facts. These deliberately narrow cues identify an
 * explicitly named metric close to a claim; if prose stays generic, the
 * verifier falls back to path/value/unit checks instead of guessing intent.
 */
const SUBJECT_CUES: SubjectCue[] = [
  {
    subject: 'engagementRateByFollower',
    pattern: /\b(?:engagement rate (?:by|per) followers?|follower(?:-based)? engagement rate)\b/gi,
  },
  {
    subject: 'engagementRateByView',
    pattern: /\b(?:engagement rate (?:by|per) views?|view(?:-based)? engagement rate)\b/gi,
  },
  {
    subject: 'engagementPerPost',
    pattern: /\b(?:engagement per post|average engagement(?: per post)?)\b/gi,
  },
  {
    subject: 'viewsPerPost',
    pattern: /\b(?:views? per post|average views? per post)\b/gi,
  },
  {
    subject: 'postsPerDay',
    pattern: /\b(?:posts? per day|daily (?:post|posting) (?:rate|cadence|volume))\b/gi,
  },
  {
    subject: 'postsPerWeek',
    pattern: /\b(?:posts? per week|weekly (?:post|posting) (?:rate|cadence|volume))\b/gi,
  },
  {
    subject: 'audienceGrowthRate',
    pattern: /\b(?:audience|follower) growth rate\b/gi,
  },
  {
    subject: 'audienceNetChange',
    pattern: /\b(?:(?:audience|follower) net change|followers? (?:gained|added|lost)|(?:gained|added|lost) followers?)\b/gi,
  },
  {
    subject: 'shareOfEngagement',
    pattern: /\bshare of engagement\b/gi,
  },
  {
    subject: 'shareOfVoice',
    pattern: /\bshare of voice\b/gi,
  },
  {
    subject: 'shareOfPosts',
    pattern: /\bshare of posts\b/gi,
  },
  {
    subject: 'engagementRate',
    pattern: /\bengagement rate\b/gi,
  },
  {
    subject: 'engagementTotal',
    pattern: /\b(?:total )?engagements?|reactions?\b/gi,
  },
  { subject: 'views', pattern: /\bviews?\b/gi },
  { subject: 'applause', pattern: /\b(?:applause|likes?|favorites?|hearts?)\b/gi },
  { subject: 'conversation', pattern: /\b(?:conversation|comments?|replies)\b/gi },
  { subject: 'amplification', pattern: /\b(?:amplification|shares?|reposts?|retweets?)\b/gi },
  { subject: 'saves', pattern: /\b(?:saves?|bookmarks?)\b/gi },
  {
    subject: 'audience',
    pattern: /\b(?:audience|followers?|following)\b/gi,
  },
  {
    subject: 'posts',
    pattern: /\b(?:posts?|published|publishing|posted)\b/gi,
  },
  { subject: 'days', pattern: /\bdays?\b/gi },
  { subject: 'rank', pattern: /\b(?:rank(?:ed|ing)?|place(?:d)?)\b/gi },
  { subject: 'lift', pattern: /\blift\b/gi },
  { subject: 'outlierScore', pattern: /\boutlier score\b/gi },
  { subject: 'zScore', pattern: /\bz(?:-| )?score\b/gi },
];

function distanceFromClaim(
  cueStart: number,
  cueEnd: number,
  claimStart: number,
  claimEnd: number,
): number {
  if (cueEnd <= claimStart) return claimStart - cueEnd;
  if (cueStart >= claimEnd) return cueStart - claimEnd;
  return 0;
}

function subjectForClaim(
  sentence: string,
  claimStart: number,
  claimEnd: number,
): NumericSubject | undefined {
  let best: { subject: NumericSubject; distance: number; priority: number } | undefined;
  SUBJECT_CUES.forEach((cue, priority) => {
    cue.pattern.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = cue.pattern.exec(sentence)) !== null) {
      const distance = distanceFromClaim(
        match.index,
        match.index + match[0].length,
        claimStart,
        claimEnd,
      );
      if (distance > 36) continue;
      if (
        !best
        || distance < best.distance
        || (distance === best.distance && priority < best.priority)
      ) {
        best = { subject: cue.subject, distance, priority };
      }
    }
  });
  return best?.subject;
}

function splitSentences(text: string): string[] {
  return text
    .split(/\n{2,}|(?<=[.!?])\s+(?=[A-Z"'“])|\n(?=#)/)
    .map((s) => s.replace(/\s+/g, ' ').trim())
    .filter(Boolean);
}

/**
 * Tolerance is derived from how precisely the number was written, which is the
 * only defensible rule: someone who writes "1.2M" has claimed the value lies in
 * [1.15M, 1.25M] and nothing more. Half a unit in the last written place.
 */
function toleranceFor(mantissa: string, multiplier: number): number {
  const decimals = mantissa.includes('.') ? mantissa.split('.')[1].length : 0;
  const ulp = multiplier * Math.pow(10, -decimals);
  return Math.max(ulp / 2, 1e-9);
}

/* ---------------------------------------------------------------- matching */

interface Candidate {
  value: number;
  tolerance: number;
  unit: NumericUnit;
  /**
   * Percentage prose has two possible representations only when it is checked
   * against an untyped fact-sheet value. Rendered percentages always use
   * display points, so "50%" cannot ground "0.5%" (or vice versa).
   */
  percentRepresentation?: 'display' | 'fraction';
}

function candidatesFor(
  sign: number,
  mantissa: string,
  suffix: string | undefined,
  currency: boolean,
): Candidate[] {
  const bare = Number(mantissa.replace(/,/g, ''));
  if (!Number.isFinite(bare)) return [];
  const unit = suffix ? suffix.toLowerCase() : '';
  const multiplier = MULTIPLIERS[unit] ?? 1;
  const tol = toleranceFor(mantissa, multiplier);
  const scaled = sign * bare * multiplier;

  if (unit === '%') {
    // Fact sheets store fractional change (0.27) but prose says 27%. Accept both,
    // and accept a rate stored as a fraction printed as a percentage.
    return [
      {
        value: scaled,
        tolerance: tol,
        unit: 'percent',
        percentRepresentation: 'display',
      },
      {
        value: scaled / 100,
        tolerance: tol / 100,
        unit: 'percent',
        percentRepresentation: 'fraction',
      },
    ];
  }
  return [{
    value: scaled,
    tolerance: tol,
    unit: currency ? 'currency' : 'number',
  }];
}

function matchEntry(
  entries: NumericSourceEntry[],
  candidates: Candidate[],
  subject?: NumericSubject,
): NumericSourceEntry | null {
  for (const c of candidates) {
    for (const e of entries) {
      if (e.unit !== undefined && e.unit !== c.unit) continue;
      if (subject && e.subject && !subjectsCompatible(subject, e.subject)) continue;
      if (
        e.unit === 'percent'
        && c.percentRepresentation !== (e.percentRepresentation ?? 'display')
      ) continue;
      if (e.tolerance !== undefined && c.tolerance < e.tolerance) continue;
      if (Math.abs(e.value - c.value) <= c.tolerance) return e;
    }
  }
  return null;
}

function subjectsCompatible(claim: NumericSubject, source: NumericSubject): boolean {
  if (claim === source) return true;
  return claim === 'engagementRate'
    && (source === 'engagementRateByFollower' || source === 'engagementRateByView');
}

function nearestEntry(
  entries: NumericSourceEntry[],
  target: number,
): { path: string; value: number; delta: number } | undefined {
  let best: NumericSourceEntry | null = null;
  let bestDelta = Number.POSITIVE_INFINITY;
  for (const e of entries) {
    const delta = Math.abs(e.value - target);
    if (delta < bestDelta) { bestDelta = delta; best = e; }
  }
  return best ? { path: best.path, value: best.value, delta: bestDelta } : undefined;
}

/**
 * Index the figures exactly exposed in a rendered source block. Unlike a
 * fact-sheet object, a report section has already applied display rounding and
 * percentage formatting. Indexing the rendered material preserves that
 * precision boundary: "1.2M" supports "1.2M", but not an invented "1,234,567".
 */
export function indexMaterialNumbers(
  material: string,
  root = 'material',
): NumericSourceEntry[] {
  const entries: NumericSourceEntry[] = [];
  const seen = new Set<string>();
  const source = stripNonClaims(material ?? '');
  NUMBER_RE.lastIndex = 0;
  let match: RegExpExecArray | null;
  let index = 0;
  while ((match = NUMBER_RE.exec(source)) !== null) {
    const [, signRaw, currencyRaw, mantissa, suffix] = match;
    const sign = signRaw === '-' || signRaw === '−' ? -1 : 1;
    const candidates = candidatesFor(sign, mantissa, suffix, currencyRaw === '$')
      .filter((candidate) => candidate.percentRepresentation !== 'fraction');
    const subject = subjectForClaim(source, match.index, match.index + match[0].length);
    for (const candidate of candidates) {
      const path = root + '[' + index + ']';
      const dedupe = path + '=' + candidate.value + ':' + candidate.unit
        + ':' + candidate.tolerance;
      if (!seen.has(dedupe)) {
        seen.add(dedupe);
        entries.push({
          path,
          value: candidate.value,
          unit: candidate.unit,
          percentRepresentation: candidate.percentRepresentation,
          tolerance: candidate.tolerance,
          ...(subject ? { subject } : {}),
        });
      }
    }
    index += 1;
  }
  return entries;
}

/* ------------------------------------------------------------ caveat check */

const STOPWORDS = new Set([
  'the', 'and', 'for', 'this', 'that', 'with', 'from', 'into', 'over', 'than',
  'were', 'was', 'are', 'is', 'has', 'have', 'had', 'may', 'not', 'but', 'its',
  'their', 'they', 'because', 'which', 'when', 'only', 'some', 'all', 'been',
]);

function distinctiveWords(text: string): string[] {
  return Array.from(new Set(
    text.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/)
      .filter((w) => w.length > 3 && !STOPWORDS.has(w)),
  ));
}

/**
 * Caveats rarely survive verbatim — the model is told to reword them into the
 * sentence they qualify, which is the right behaviour for a reader and an
 * inconvenient one for a checker. So coverage is measured by distinctive-word
 * overlap: most of the load-bearing words present, in a document this short,
 * means the caveat was carried through rather than dropped.
 */
function caveatCovered(caveat: string, body: string): boolean {
  const normalised = body.toLowerCase();
  if (normalised.includes(caveat.toLowerCase().trim())) return true;
  const words = distinctiveWords(caveat);
  if (words.length === 0) return true;
  const hits = words.filter((w) => normalised.includes(w)).length;
  return hits / words.length >= 0.6;
}

/* ---------------------------------------------------------------- verify */

type CoreVerification = NumericGroundingVerification & {
  miscited: string[];
  cited: number;
};

type VerificationOptions = {
  sourceLabel: string;
  requireCitations: boolean;
};

/*
 * A deterministic checker cannot let "three posts" disappear merely because
 * the extractor only parsed digits. Reject spelled-out quantities and let the
 * bounded repair pass rewrite them as cited numeric claims. This intentionally
 * includes "one": prose can use "a" or "the only" when it is not making a
 * measurable claim.
 */
const SPELLED_QUANTITY_RE = /\b(?:zero|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety|hundred|thousand|million|billion|dozen|both)\b/gi;

/**
 * Shared numeric-verification engine. Callers define the allowed numeric
 * entries; this function owns claim extraction, normalization, matching,
 * runaway-percentage checks, and optional citation enforcement.
 */
function verifyAgainstEntries(
  markdown: string,
  entries: NumericSourceEntry[],
  options: VerificationOptions,
): CoreVerification {
  // Sentences are split on the original text so citations stay attached to the
  // sentence they qualify; scrubbing happens per sentence, just before parsing.
  const sentences = splitSentences(markdown ?? '');
  const claims: NumericClaim[] = [];
  const unverified: string[] = [];
  const violations: string[] = [];
  const miscited: string[] = [];
  const entriesByPath = new Map(entries.map((entry) => [entry.path, entry]));

  sentences.forEach((original) => {
    const sentence = stripNonClaims(original);
    const citedPaths = factCitations(original);
    const display = original.length > 240 ? original.slice(0, 240) + '\u2026' : original;
    SPELLED_QUANTITY_RE.lastIndex = 0;
    for (const word of sentence.matchAll(SPELLED_QUANTITY_RE)) {
      violations.push(
        'Spelled-out quantity "' + word[0] + '" cannot be verified. Use digits and an exact '
        + 'supporting citation, or remove the quantity: "' + display + '"',
      );
    }
    const parsed: {
      raw: string;
      candidates: Candidate[];
      primary: number;
      subject?: NumericSubject;
      globalHit: NumericSourceEntry | null;
    }[] = [];

    NUMBER_RE.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = NUMBER_RE.exec(sentence)) !== null) {
      const [rawFull, signRaw, currencyRaw, mantissa, suffix] = match;
      const raw = rawFull.trim();
      if (!raw) continue;
      const sign = signRaw === '-' || signRaw === '−' ? -1 : 1;
      const candidates = candidatesFor(sign, mantissa, suffix, currencyRaw === '$');
      if (candidates.length === 0) continue;

      const primary = candidates[0].value;
      if (
        suffix === '%'
        && (
          primary > PRINTED_PERCENT_CHANGE_GUARDRAILS.maximum
          || primary < PRINTED_PERCENT_CHANGE_GUARDRAILS.minimum
        )
      ) {
        violations.push(
          'Printed a percent change of ' + raw + ', which the honesty rules require be described '
          + 'qualitatively (near-zero baseline): "' + sentence.slice(0, 160) + '"',
        );
      }

      const subject = subjectForClaim(sentence, match.index, match.index + rawFull.length);
      parsed.push({
        raw,
        candidates,
        primary,
        subject,
        globalHit: matchEntry(entries, candidates, subject),
      });
    }

    /*
     * The prompt requires citation paths in claim order. Assign each available
     * path to the claim in the same position. Numeric
     * caveats have no exemption: the prompt requires them to be paraphrased
     * qualitatively unless the number has a real NUMBER INDEX path.
     */
    const assignedCitations = new Map<number, string>();
    if (citedPaths.length === parsed.length) {
      citedPaths.forEach((path, index) => assignedCitations.set(index, path));
    } else {
      let citationIndex = 0;
      parsed.forEach((claim, index) => {
        const path = citedPaths[citationIndex];
        if (path) assignedCitations.set(index, path);
        citationIndex += 1;
      });
    }

    parsed.forEach((parsedClaim, index) => {
      const citedPath = assignedCitations.get(index);
      const citedEntry = citedPath ? entriesByPath.get(citedPath) : undefined;
      const citedHit = citedEntry
        ? matchEntry([citedEntry], parsedClaim.candidates, parsedClaim.subject)
        : null;
      const hit = citedHit ?? parsedClaim.globalHit;
      const claim: NumericClaim = {
        text: display,
        raw: parsedClaim.raw,
        value: parsedClaim.primary,
        found: Boolean(parsedClaim.globalHit),
        ...(citedPath ? { citedPath } : {}),
        matchedPath: hit?.path,
        nearest: parsedClaim.globalHit
          ? undefined
          : nearestEntry(entries, parsedClaim.primary),
      };
      claims.push(claim);

      if (!parsedClaim.globalHit) {
        unverified.push(
          parsedClaim.raw + ' does not appear in ' + options.sourceLabel
          + (claim.nearest
            ? ' (closest: ' + claim.nearest.path + ' = ' + claim.nearest.value + ')'
            : '')
          + ' — "' + claim.text + '"',
        );
      }

      if (!options.requireCitations) return;
      if (!citedPath) {
        violations.push('Uncited figure ' + parsedClaim.raw + ' — "' + claim.text + '"');
      } else if (!citedEntry) {
        miscited.push(
          parsedClaim.raw + ' cited ' + citedPath
          + ', but that path was not exposed in the prompt'
          + ' — "' + claim.text + '"',
        );
      } else if (!citedHit) {
        const numericAtPath = matchEntry([citedEntry], parsedClaim.candidates);
        const reason = numericAtPath && parsedClaim.subject && citedEntry.subject
          ? ' describes ' + citedEntry.subject + ', while the claim describes '
            + parsedClaim.subject
          : ' contains ' + citedEntry.value + ', which does not support the stated value';
        miscited.push(
          parsedClaim.raw + ' cited ' + citedPath + ', which' + reason
          + ' — "' + claim.text + '"',
        );
      }
    });
  });

  const grounded = claims.filter((claim) => claim.found).length;
  const cited = claims.filter((claim) => claim.citedPath).length;
  return {
    ok: unverified.length === 0 && violations.length === 0 && miscited.length === 0,
    claims,
    unverified,
    violations,
    miscited,
    stats: { total: claims.length, grounded },
    cited,
    checkedAt: new Date().toISOString(),
  };
}

/**
 * Verify every quantitative claim in prose against the exact rendered material
 * supplied to a model or editor. Dates, times, explicitly temporal years,
 * links, and code are not quantitative claims. Citations are not required
 * because report narratives render as plain prose.
 */
export function verifyNumbersAgainstMaterial(
  prose: string,
  material: string,
): NumericGroundingVerification {
  const result = verifyAgainstEntries(prose, indexMaterialNumbers(material), {
    sourceLabel: 'the supplied report section',
    requireCitations: false,
  });
  return {
    ok: result.ok,
    claims: result.claims,
    unverified: result.unverified,
    violations: result.violations,
    stats: result.stats,
    checkedAt: result.checkedAt,
  };
}

/**
 * Verify an Ask answer without forcing it to repeat every fact-sheet caveat.
 *
 * A short answer must carry any relevant caveat, but relevance depends on the
 * question and is not safely decidable with string overlap. Numeric grounding
 * and exact citation semantics remain absolute and deterministic here.
 */
export function verifyFactSheetAnswer(
  answer: string,
  facts: FactSheet,
): FactSheetAnswerVerification {
  const result = verifyAgainstEntries(
    answer,
    indexFactNumbers(facts),
    {
      sourceLabel: 'the fact sheet',
      requireCitations: true,
    },
  );

  return {
    ok: result.ok,
    claims: result.claims,
    unverified: result.unverified,
    violations: result.violations,
    miscited: result.miscited,
    stats: {
      total: result.stats.total,
      grounded: result.stats.grounded,
      cited: result.cited,
    },
    checkedAt: result.checkedAt,
  };
}

/**
 * Check a generated brief against the fact sheet it was generated from.
 *
 * Never throws. A verification pass that can fail is a verification pass that
 * gets caught and ignored at the call site; this one always returns a verdict,
 * and an unparseable brief simply has no grounded claims.
 */
export function verifyBrief(markdown: string, facts: FactSheet): BriefVerification {
  const result = verifyAgainstEntries(
    markdown,
    indexFactNumbers(facts),
    {
      sourceLabel: 'the fact sheet',
      requireCitations: true,
    },
  );

  const missingCaveats = (facts.caveats ?? []).filter((c) => c.trim() && !caveatCovered(c, markdown ?? ''));
  for (const c of missingCaveats) {
    result.violations.push('Caveat not reflected in the output: "' + c + '"');
  }

  return {
    ok: result.unverified.length === 0
      && result.violations.length === 0
      && result.miscited.length === 0,
    claims: result.claims,
    unverified: result.unverified,
    violations: result.violations,
    missingCaveats,
    miscited: result.miscited,
    stats: {
      total: result.stats.total,
      grounded: result.stats.grounded,
      cited: result.cited,
    },
    checkedAt: result.checkedAt,
  };
}

/** One-line summary for logs, alert bodies, and the brief header. */
export function summarizeVerification(v: BriefVerification): string {
  if (v.stats.total === 0) return 'No numeric claims to verify.';
  if (v.ok) return 'All ' + v.stats.total + ' numeric claims verified against the fact sheet.';
  return v.stats.grounded + ' of ' + v.stats.total + ' numeric claims verified; '
    + v.unverified.length + ' unverified, ' + v.violations.length + ' rule violations.';
}
