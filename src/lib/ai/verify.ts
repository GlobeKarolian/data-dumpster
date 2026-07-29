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

export interface BriefVerification {
  /** True only when every check passed: numbers, percentages, and caveats. */
  ok: boolean;
  claims: NumericClaim[];
  /** Human-readable description of each claim that could not be grounded. */
  unverified: string[];
  /** Rule violations that are not about grounding, e.g. a printed +4300%. */
  violations: string[];
  /** Caveats from the fact sheet that did not make it into the text. */
  missingCaveats: string[];
  /** Claims that were grounded but cited a path other than the matching one. */
  miscited: string[];
  stats: { total: number; grounded: number; cited: number };
  checkedAt: string;
}

/* --------------------------------------------------------- fact-sheet index */

interface Entry { path: string; value: number }

/** Every finite number in the fact sheet, with the path a citation would use. */
export function indexFactNumbers(facts: FactSheet): Entry[] {
  const out: Entry[] = [];
  const seen = new Set<string>();
  const walk = (node: unknown, path: string): void => {
    if (typeof node === 'number') {
      if (Number.isFinite(node)) {
        const dedupe = path + '=' + node;
        if (!seen.has(dedupe)) { seen.add(dedupe); out.push({ path, value: node }); }
      }
      return;
    }
    if (Array.isArray(node)) {
      node.forEach((item, i) => walk(item, path + '[' + i + ']'));
      return;
    }
    if (node && typeof node === 'object') {
      for (const [k, v] of Object.entries(node as Record<string, unknown>)) {
        walk(v, path ? path + '.' + k : k);
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
  + '([+\\-\\u2212]?)\\$?'
  + '(\\d{1,3}(?:,\\d{3})+(?:\\.\\d+)?|\\d+(?:\\.\\d+)?)'
  + '\\s*'
  + '(%|k\\b|K\\b|MM\\b|M\\b|bn\\b|B\\b|thousand\\b|million\\b|billion\\b)?',
  'g',
);

const MONTHS = 'jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?'
  + '|aug(?:ust)?|sep(?:t|tember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?';

/** Strip everything that contains digits which are not quantitative claims. */
function stripNonClaims(markdown: string): string {
  return markdown
    // Citations: [facts.leaderboards.engagementTotal[0].value]
    .replace(/\[facts[^\]]*\]/g, ' ')
    // Markdown links and images: the URL is not a claim.
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1')
    // Fenced and inline code.
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/`[^`]*`/g, ' ')
    // ISO dates and bare years: period boundaries, not measurements.
    .replace(/\d{4}-\d{2}-\d{2}/g, ' ')
    .replace(/(?<![\w.])(19|20)\d{2}(?![\w.])/g, ' ')
    // Clock times.
    .replace(/(?<![\w.])\d{1,2}:\d{2}(?::\d{2})?/g, ' ')
    // Calendar dates written in prose ("July 18", "18 July", "Sept. 3rd").
    // A day of the month is a location in time, not a measurement.
    .replace(new RegExp('\\b(' + MONTHS + ')\\.?\\s+\\d{1,2}(st|nd|rd|th)?\\b', 'gi'), ' ')
    .replace(new RegExp('\\b\\d{1,2}(st|nd|rd|th)?\\s+(' + MONTHS + ')\\b', 'gi'), ' ');
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

interface Candidate { value: number; tolerance: number }

function candidatesFor(sign: number, mantissa: string, suffix: string | undefined): Candidate[] {
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
      { value: scaled, tolerance: tol },
      { value: scaled / 100, tolerance: tol / 100 },
    ];
  }
  return [{ value: scaled, tolerance: tol }];
}

function matchEntry(entries: Entry[], candidates: Candidate[]): Entry | null {
  for (const c of candidates) {
    for (const e of entries) {
      if (Math.abs(e.value - c.value) <= c.tolerance) return e;
    }
  }
  return null;
}

function nearestEntry(entries: Entry[], target: number): { path: string; value: number; delta: number } | undefined {
  let best: Entry | null = null;
  let bestDelta = Number.POSITIVE_INFINITY;
  for (const e of entries) {
    const delta = Math.abs(e.value - target);
    if (delta < bestDelta) { bestDelta = delta; best = e; }
  }
  return best ? { path: best.path, value: best.value, delta: bestDelta } : undefined;
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

/**
 * Check a generated brief against the fact sheet it was generated from.
 *
 * Never throws. A verification pass that can fail is a verification pass that
 * gets caught and ignored at the call site; this one always returns a verdict,
 * and an unparseable brief simply has no grounded claims.
 */
export function verifyBrief(markdown: string, facts: FactSheet): BriefVerification {
  const entries = indexFactNumbers(facts);
  // Sentences are split on the original text so citations stay attached to the
  // sentence they qualify; scrubbing happens per sentence, just before parsing.
  const sentences = splitSentences(markdown ?? '');

  const claims: NumericClaim[] = [];
  const unverified: string[] = [];
  const violations: string[] = [];
  const miscited: string[] = [];

  sentences.forEach((original) => {
    const sentence = stripNonClaims(original);
    const citedPaths = Array.from(original.matchAll(/\[(facts[^\]]*)\]/g)).map((m) => m[1].trim());
    const display = original.length > 240 ? original.slice(0, 240) + '\u2026' : original;

    NUMBER_RE.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = NUMBER_RE.exec(sentence)) !== null) {
      const [rawFull, signRaw, mantissa, suffix] = match;
      const raw = rawFull.trim();
      if (!raw) continue;
      const sign = signRaw === '-' || signRaw === '−' ? -1 : 1;
      const candidates = candidatesFor(sign, mantissa, suffix);
      if (candidates.length === 0) continue;

      const primary = candidates[0].value;

      // Rule 3: a printed percent change above 1000% is always a near-zero
      // baseline artefact. The prompt forbids it; this proves it did not happen.
      if (suffix === '%' && Math.abs(primary) > 1000) {
        violations.push(
          'Printed a percent change of ' + raw + ', which the honesty rules require be described '
          + 'qualitatively (near-zero baseline): "' + sentence.slice(0, 160) + '"',
        );
      }

      // A number the model copied out of a caveat is not a claim it made; it is
      // a caveat it was required to restate. Ground it to the caveat itself
      // rather than demanding a citation the prompt never asked for.
      const caveatIndex = (facts.caveats ?? []).findIndex(
        (c) => c.replace(/\s+/g, ' ').includes(raw),
      );
      if (caveatIndex >= 0) {
        claims.push({
          text: display,
          raw,
          value: candidates[0].value,
          found: true,
          matchedPath: 'facts.caveats[' + caveatIndex + ']',
        });
        continue;
      }

      const hit = matchEntry(entries, candidates);
      const claim: NumericClaim = {
        text: display,
        raw,
        value: primary,
        found: Boolean(hit),
        citedPath: citedPaths[0],
        matchedPath: hit?.path,
        nearest: hit ? undefined : nearestEntry(entries, primary),
      };
      claims.push(claim);

      if (!hit) {
        unverified.push(
          raw + ' does not appear in the fact sheet'
          + (claim.nearest
            ? ' (closest: ' + claim.nearest.path + ' = ' + claim.nearest.value + ')'
            : '')
          + ' — "' + claim.text + '"',
        );
      } else if (citedPaths.length > 0 && !citedPaths.includes(hit.path)) {
        // Grounded but pointed at the wrong path: the number is real, the
        // provenance is wrong, and an editor tracing the claim would be misled.
        miscited.push(
          raw + ' matched ' + hit.path + ' but was cited as ' + citedPaths.join(', ')
          + ' — "' + claim.text + '"',
        );
      } else if (citedPaths.length === 0) {
        violations.push('Uncited figure ' + raw + ' — "' + claim.text + '"');
      }
    }
  });

  const missingCaveats = (facts.caveats ?? []).filter((c) => c.trim() && !caveatCovered(c, markdown ?? ''));
  for (const c of missingCaveats) {
    violations.push('Caveat not reflected in the output: "' + c + '"');
  }

  const grounded = claims.filter((c) => c.found).length;
  const cited = claims.filter((c) => c.citedPath).length;

  return {
    ok: unverified.length === 0 && violations.length === 0 && miscited.length === 0,
    claims,
    unverified,
    violations,
    missingCaveats,
    miscited,
    stats: { total: claims.length, grounded, cited },
    checkedAt: new Date().toISOString(),
  };
}

/** One-line summary for logs, alert bodies, and the brief header. */
export function summarizeVerification(v: BriefVerification): string {
  if (v.stats.total === 0) return 'No numeric claims to verify.';
  if (v.ok) return 'All ' + v.stats.total + ' numeric claims verified against the fact sheet.';
  return v.stats.grounded + ' of ' + v.stats.total + ' numeric claims verified; '
    + v.unverified.length + ' unverified, ' + v.violations.length + ' rule violations.';
}
