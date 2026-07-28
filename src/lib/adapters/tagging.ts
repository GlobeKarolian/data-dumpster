/**
 * Rule-based auto-tagging.
 *
 * Evaluates the `rule` JSON on `post_tags` (see db/schema.ts) against a post at
 * ingest time. This is the deterministic half of the tagging system; the AI
 * tagger handles tags that only have an `aiPrompt`.
 *
 * Two properties matter more than anything else here:
 *
 *  1. **It must never throw.** This runs inside the ingest loop, once per post
 *     per tag. A user typing a broken regex into a settings form must not be
 *     able to fail an entire night's ingestion for their whole org.
 *  2. **It must be cheap.** A hundred channels x a few hundred posts x a few
 *     dozen tags is millions of evaluations, so the searchable text is built
 *     once per post and regexes are compiled once per pattern, not per call.
 */
import type { PostType } from '@/lib/types';

/** The rule shape stored on `post_tags.rule`. Mirrors the schema exactly. */
export interface TagRule {
  anyKeywords?: string[];
  allKeywords?: string[];
  noneKeywords?: string[];
  hashtags?: string[];
  platforms?: string[];
  postTypes?: string[];
  urlDomains?: string[];
  urlPathContains?: string[];
  regex?: string;
}

/**
 * The subset of a post a rule can see. Structured so both a `NormalizedPost`
 * (during ingest, before the row exists) and a `posts` row (during a re-tag
 * backfill) satisfy it without adaptation.
 */
export interface TaggablePost {
  text?: string | null;
  hashtags?: string[] | null;
  mentions?: string[] | null;
  urls?: string[] | null;
  platform?: string | null;
  type?: PostType | string | null;
}

/* --------------------------------------------------------------- regex */

/**
 * Compiled-pattern cache. Rules change rarely and are applied to every post, so
 * without this we would recompile the same regex millions of times per run.
 * `null` is cached for invalid patterns so a broken rule costs one failed
 * compile, not one per post.
 */
const REGEX_CACHE = new Map<string, RegExp | null>();
const REGEX_CACHE_MAX = 500;

/**
 * A user-supplied pattern can be invalid, and on some engines can be
 * pathological. Invalid patterns are cached as `null` and treated as
 * "no match" — never as an exception, and never as "matches everything", which
 * would silently apply the tag to every post in the system.
 */
function compile(pattern: string): RegExp | null {
  const cached = REGEX_CACHE.get(pattern);
  if (cached !== undefined) return cached;

  let compiled: RegExp | null = null;
  try {
    // Case-insensitive to match the rest of the rule vocabulary; no `g`, since
    // a stateful `lastIndex` would make results depend on call order.
    compiled = new RegExp(pattern, 'i');
  } catch {
    compiled = null;
  }

  // Crude bound on cache growth. Rules are few; this only trips if something
  // upstream starts generating patterns.
  if (REGEX_CACHE.size >= REGEX_CACHE_MAX) REGEX_CACHE.clear();
  REGEX_CACHE.set(pattern, compiled);
  return compiled;
}

/* ------------------------------------------------------------ matching */

function nonEmpty(values: string[] | undefined | null): string[] {
  if (!Array.isArray(values)) return [];
  return values.map((v) => (typeof v === 'string' ? v.trim() : '')).filter((v) => v.length > 0);
}

/**
 * The haystack a keyword rule searches: post text plus hashtags.
 *
 * Hashtags are included because "election" should match a post tagged
 * `#Election2026` even when the word never appears in the prose — that is what
 * an analyst means by "posts about the election". URLs are deliberately
 * *excluded*: a syndication link containing "/sports/" would otherwise make
 * every article match a "sports" keyword rule. URLs have their own two
 * criteria below.
 */
function buildHaystack(post: TaggablePost): string {
  const parts: string[] = [];
  if (typeof post.text === 'string' && post.text) parts.push(post.text);
  const tags = nonEmpty(post.hashtags);
  if (tags.length > 0) parts.push(tags.join(' '));
  return parts.join('\n').toLowerCase();
}

/**
 * Keyword semantics.
 *
 * A single-word keyword is matched on word boundaries, so "art" does not match
 * "start" and a tag called "AI" does not attach itself to every post containing
 * "said". A multi-word phrase is matched as a substring, because phrases carry
 * their own boundaries and users expect "city council" to match "city councils".
 * Keywords containing regex metacharacters are escaped — this field is a
 * keyword list, not a second regex field.
 */
function containsKeyword(haystack: string, keyword: string): boolean {
  const needle = keyword.trim().toLowerCase();
  if (!needle) return false;
  if (/\s/.test(needle) || !/^[a-z0-9'’_-]+$/i.test(needle)) return haystack.includes(needle);

  const escaped = needle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const bounded = compile(`(^|[^a-z0-9_])${escaped}([^a-z0-9_]|$)`);
  return bounded ? bounded.test(haystack) : haystack.includes(needle);
}

/** Hashtags compare case-insensitively with any leading `#` ignored on both sides. */
function normalizeTag(tag: string): string {
  return tag.trim().replace(/^#+/, '').toLowerCase();
}

interface ParsedUrl {
  host: string;
  pathAndQuery: string;
}

function parseUrls(urls: string[]): ParsedUrl[] {
  const out: ParsedUrl[] = [];
  for (const raw of urls) {
    try {
      const url = new URL(raw.includes('://') ? raw : `https://${raw}`);
      out.push({
        // `www.` is stripped so a rule for "globe.com" matches
        // "www.globe.com"; users do not think of those as different sites.
        host: url.hostname.toLowerCase().replace(/^www\./, ''),
        pathAndQuery: `${url.pathname}${url.search}`.toLowerCase(),
      });
    } catch {
      // Not a parseable URL. Skip it rather than failing the whole rule.
      continue;
    }
  }
  return out;
}

/** `globe.com` matches `globe.com` and `www.globe.com` and `apps.globe.com`,
 *  but not `notglobe.com`. */
function hostMatches(host: string, domain: string): boolean {
  const target = domain.trim().toLowerCase().replace(/^\*?\./, '').replace(/^www\./, '');
  if (!target) return false;
  return host === target || host.endsWith(`.${target}`);
}

/**
 * Evaluate a rule against a post.
 *
 * Semantics, chosen to match how people describe these rules out loud:
 *  - **AND across criteria**: a rule with both `platforms` and `anyKeywords`
 *    means "on these platforms AND mentioning one of these words".
 *  - **OR within a criterion**: `anyKeywords: ['a','b']` means either.
 *  - `allKeywords` requires every entry; `noneKeywords` vetoes the match.
 *  - An absent or empty criterion is simply not applied.
 *  - **An empty rule matches nothing.** A tag whose rule is `{}` or `null` is
 *    either unconfigured or AI-driven, and must never silently attach itself to
 *    every post in the org.
 */
export function matchesRule(rule: TagRule | null | undefined, post: TaggablePost): boolean {
  if (!rule || typeof rule !== 'object') return false;

  const anyKeywords = nonEmpty(rule.anyKeywords);
  const allKeywords = nonEmpty(rule.allKeywords);
  const noneKeywords = nonEmpty(rule.noneKeywords);
  const hashtags = nonEmpty(rule.hashtags);
  const platforms = nonEmpty(rule.platforms);
  const postTypes = nonEmpty(rule.postTypes);
  const urlDomains = nonEmpty(rule.urlDomains);
  const urlPathContains = nonEmpty(rule.urlPathContains);
  const regex = typeof rule.regex === 'string' ? rule.regex.trim() : '';

  const hasCriteria = anyKeywords.length > 0 || allKeywords.length > 0 || noneKeywords.length > 0
    || hashtags.length > 0 || platforms.length > 0 || postTypes.length > 0
    || urlDomains.length > 0 || urlPathContains.length > 0 || regex.length > 0;
  if (!hasCriteria) return false;

  // Cheapest, most selective checks first: these reject most posts without
  // touching the text.
  if (platforms.length > 0) {
    const platform = (post.platform ?? '').toLowerCase();
    if (!platforms.some((p) => p.toLowerCase() === platform)) return false;
  }

  if (postTypes.length > 0) {
    const type = String(post.type ?? '').toLowerCase();
    if (!postTypes.some((t) => t.toLowerCase() === type)) return false;
  }

  if (hashtags.length > 0) {
    const postTags = new Set(nonEmpty(post.hashtags).map(normalizeTag));
    if (!hashtags.some((t) => postTags.has(normalizeTag(t)))) return false;
  }

  const needsUrls = urlDomains.length > 0 || urlPathContains.length > 0;
  if (needsUrls) {
    const parsed = parseUrls(nonEmpty(post.urls));
    if (urlDomains.length > 0) {
      if (!parsed.some((u) => urlDomains.some((d) => hostMatches(u.host, d)))) return false;
    }
    if (urlPathContains.length > 0) {
      const fragments = urlPathContains.map((f) => f.trim().toLowerCase()).filter(Boolean);
      if (!parsed.some((u) => fragments.some((f) => u.pathAndQuery.includes(f)))) return false;
    }
  }

  const needsText = anyKeywords.length > 0 || allKeywords.length > 0 || noneKeywords.length > 0 || regex.length > 0;
  if (!needsText) return true;

  const haystack = buildHaystack(post);

  // The veto runs before the positive keyword checks: it is the cheaper way to
  // reject, and it is what users expect ("about the mayor, but not opinion").
  if (noneKeywords.length > 0 && noneKeywords.some((k) => containsKeyword(haystack, k))) return false;
  if (anyKeywords.length > 0 && !anyKeywords.some((k) => containsKeyword(haystack, k))) return false;
  if (allKeywords.length > 0 && !allKeywords.every((k) => containsKeyword(haystack, k))) return false;

  if (regex.length > 0) {
    const compiled = compile(regex);
    // A pattern that will not compile can never match. It must not throw, and
    // it must not pass — a broken rule that tagged everything would be worse
    // than one that tags nothing, because nobody would notice.
    if (!compiled) return false;
    try {
      // Run against the original-case text: users write patterns like
      // `\bBREAKING\b` and expect case-sensitivity to be their choice via the
      // pattern, though the compiled flag is `i` for consistency with keywords.
      if (!compiled.test(post.text ?? haystack)) return false;
    } catch {
      return false;
    }
  }

  return true;
}

/**
 * Which of a set of tags apply to a post. The ingest path calls this once per
 * post rather than calling `matchesRule` in a loop, so the caller does not have
 * to remember to skip rule-less (AI-only) tags.
 */
export function matchingTagIds<T extends { id: string; rule?: TagRule | null }>(
  tags: readonly T[],
  post: TaggablePost,
): string[] {
  const matched: string[] = [];
  for (const tag of tags) {
    if (matchesRule(tag.rule, post)) matched.push(tag.id);
  }
  return matched;
}

/** Exposed for tests and for the settings UI's "why did this not match?" panel. */
export function isValidRegex(pattern: string): boolean {
  return compile(pattern) !== null;
}
