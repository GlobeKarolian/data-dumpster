/**
 * Pure normalization helpers shared by every adapter.
 *
 * Why these live here instead of inside each adapter:
 *
 *  1. **Cross-platform comparisons are only honest if the inputs were derived
 *     identically.** If the YouTube adapter counted "#Election2026" and the
 *     Bluesky adapter counted "#election2026" as different tags, every
 *     share-of-voice number in the product would be quietly wrong.
 *  2. **These are the functions most likely to be wrong at the edges** (unicode
 *     hashtags, trailing punctuation on URLs, handles with dots). One
 *     implementation means one place to fix and one place to test.
 *
 * Nothing here does I/O, imports a platform SDK, or throws. Adapters call these
 * on data they have already fetched; failures degrade to empty arrays rather
 * than killing an ingest run over a malformed caption.
 */
import type { Platform, PostType } from '@/lib/types';

/* ------------------------------------------------------------- entities */

/**
 * Deliberately conservative unicode ranges rather than `\p{L}` property
 * escapes: the tsconfig targets ES2017, where property escapes are not
 * guaranteed, and a regex that fails to compile at runtime would take down
 * every adapter at once. These ranges cover Latin-1/extended, Greek, Cyrillic,
 * Hebrew, Arabic, Kana and CJK, which is the realistic surface for the
 * newsrooms this tool measures.
 */
const TAG_CHARS = 'A-Za-z0-9_\\u00C0-\\u024F\\u0370-\\u03FF\\u0400-\\u04FF\\u0590-\\u06FF\\u3040-\\u30FF\\u4E00-\\u9FFF';
const HASHTAG_RE = new RegExp(`(^|[^A-Za-z0-9_&#])#([${TAG_CHARS}]{1,100})`, 'g');
const MENTION_RE = /(^|[^A-Za-z0-9_@/])@([A-Za-z0-9_](?:[A-Za-z0-9_.-]{0,62}[A-Za-z0-9_])?)/g;
const URL_RE = /\bhttps?:\/\/[^\s<>"'`\\]+/gi;

/** Punctuation that is almost always sentence punctuation, not part of the URL. */
const URL_TRAILING_JUNK = /[.,;:!?'"’”»…]+$/;

function dedupe(values: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const v of values) {
    if (!v || seen.has(v)) continue;
    seen.add(v);
    out.push(v);
  }
  return out;
}

/**
 * Hashtags without the leading `#`, lowercased and de-duplicated in order of
 * first appearance. Lowercasing is what makes "#BostonGlobe" and "#bostonglobe"
 * a single row in the tag leaderboard; the original casing is still available in
 * the post text if anyone needs it for display.
 */
export function extractHashtags(text?: string | null): string[] {
  if (!text) return [];
  const out: string[] = [];
  // URLs are blanked out first: a fragment like `example.com/page#section` is
  // not a hashtag, and neither is the `#` in a tracking parameter. Scanning the
  // raw text would put "section" in the tag leaderboard.
  const scannable = text.replace(URL_RE, ' ');
  HASHTAG_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = HASHTAG_RE.exec(scannable)) !== null) {
    const tag = m[2];
    // A tag that is only digits is a numeric reference ("#5"), not a topic.
    if (/^\d+$/.test(tag)) continue;
    out.push(tag.toLowerCase());
  }
  return dedupe(out);
}

/**
 * Mentions without the leading `@`, lowercased. Dots are allowed inside the
 * handle because AT Protocol handles are domains (`@nytimes.bsky.social`), but a
 * trailing dot is stripped so "ask @globe." does not yield "globe.".
 */
export function extractMentions(text?: string | null): string[] {
  if (!text) return [];
  const out: string[] = [];
  MENTION_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = MENTION_RE.exec(text)) !== null) {
    const handle = m[2].replace(/[.\-_]+$/, '');
    if (handle) out.push(handle.toLowerCase());
  }
  return dedupe(out);
}

/**
 * Absolute http(s) URLs found in free text.
 *
 * Two details that matter in practice: trailing sentence punctuation is stripped
 * (platforms linkify greedily, humans write "see https://x.com/a."), and an
 * unbalanced closing paren is dropped so "(https://a.com/b)" does not capture
 * the paren while "https://en.wikipedia.org/wiki/Foo_(bar)" keeps it.
 */
export function extractUrls(text?: string | null): string[] {
  if (!text) return [];
  const out: string[] = [];
  URL_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = URL_RE.exec(text)) !== null) {
    let url = m[0].replace(URL_TRAILING_JUNK, '');
    while (url.endsWith(')') && countChar(url, ')') > countChar(url, '(')) url = url.slice(0, -1);
    url = url.replace(URL_TRAILING_JUNK, '');
    if (url.length > 'https://'.length) out.push(url);
  }
  return dedupe(out);
}

function countChar(s: string, ch: string): number {
  let n = 0;
  for (let i = 0; i < s.length; i++) if (s[i] === ch) n++;
  return n;
}

/* --------------------------------------------------------- post typing */

/**
 * Everything an adapter can tell us about the shape of a post. All optional:
 * each platform knows some subset, and the classifier degrades gracefully.
 */
export interface PostTypeHints {
  platform?: Platform;
  /** The platform's own word for the post, e.g. "video", "carousel_album". */
  nativeType?: string | null;
  /** Number of attached media items, when the platform says. */
  mediaCount?: number | null;
  durationSec?: number | null;
  hasVideo?: boolean;
  hasImage?: boolean;
  hasLink?: boolean;
  isLive?: boolean;
  isRepost?: boolean;
  isPoll?: boolean;
  isArticle?: boolean;
  isStory?: boolean;
}

/** Above this, a video is regular long-form rather than a short/reel. */
const SHORT_FORM_MAX_SEC = 60;

const NATIVE_TYPE_MAP: Record<string, PostType> = {
  photo: 'photo', image: 'photo', images: 'photo', picture: 'photo',
  video: 'video', movie: 'video',
  carousel: 'carousel', carousel_album: 'carousel', album: 'carousel', gallery: 'carousel',
  reel: 'reel', reels: 'reel', clip: 'reel',
  short: 'short', shorts: 'short',
  story: 'story', stories: 'story',
  text: 'text', status: 'text', note: 'text',
  link: 'link', share: 'link', external: 'link',
  live: 'live', live_video: 'live', livestream: 'live', broadcast: 'live',
  poll: 'poll',
  repost: 'repost', retweet: 'repost', quote: 'repost', boost: 'repost',
  article: 'article', blog: 'article', entry: 'article',
};

/**
 * Short-form video is called something different everywhere, and the name is
 * what analysts actually filter on, so we honour the platform's own vocabulary
 * rather than inventing a neutral term nobody uses.
 */
function shortFormType(platform?: Platform): PostType {
  if (platform === 'youtube') return 'short';
  if (platform === 'instagram' || platform === 'facebook') return 'reel';
  return 'video';
}

/**
 * Collapse a platform's post taxonomy into the shared `PostType` vocabulary.
 *
 * Precedence is deliberate: structural facts (repost, live, poll, story) beat
 * media facts, because a repost of a video is still a repost for cadence
 * analysis. Below that, media beats links, and a bare link post beats plain
 * text. `other` only happens when a platform tells us nothing at all.
 */
export function classifyPostType(hints: PostTypeHints): PostType {
  const native = hints.nativeType?.trim().toLowerCase().replace(/[\s-]+/g, '_');
  const mapped = native ? NATIVE_TYPE_MAP[native] : undefined;

  if (hints.isRepost) return 'repost';
  if (hints.isLive || mapped === 'live') return 'live';
  if (hints.isPoll || mapped === 'poll') return 'poll';
  if (hints.isStory || mapped === 'story') return 'story';

  const isVideo = hints.hasVideo || mapped === 'video' || mapped === 'reel' || mapped === 'short';
  if (isVideo) {
    const dur = hints.durationSec;
    if (typeof dur === 'number' && dur > 0 && dur <= SHORT_FORM_MAX_SEC) return shortFormType(hints.platform);
    if (mapped === 'reel' || mapped === 'short') return mapped;
    return 'video';
  }

  if ((hints.mediaCount ?? 0) > 1 || mapped === 'carousel') return 'carousel';
  if (hints.hasImage || mapped === 'photo') return 'photo';
  if (hints.isArticle || mapped === 'article') return 'article';
  if (hints.hasLink || mapped === 'link') return 'link';
  if (mapped) return mapped;
  return 'other';
}

/* ------------------------------------------------------------- metrics */

export interface EngagementParts {
  applause?: number | null;
  conversation?: number | null;
  amplification?: number | null;
  saves?: number | null;
}

function safeCount(n: number | null | undefined): number {
  if (typeof n !== 'number' || !Number.isFinite(n) || n < 0) return 0;
  return Math.round(n);
}

/**
 * The single definition of "engagement" in this product: applause +
 * conversation + amplification + saves. Views are excluded on purpose — a view
 * is not an action a person chose to take, and folding it in would make video
 * platforms look 100x more engaging than text platforms for no real reason.
 *
 * Negative or non-finite inputs are clamped to zero rather than propagating
 * NaN into a leaderboard.
 */
export function computeEngagementTotal(parts: EngagementParts): number {
  return (
    safeCount(parts.applause) +
    safeCount(parts.conversation) +
    safeCount(parts.amplification) +
    safeCount(parts.saves)
  );
}

/**
 * `YYYY-MM-DD` in UTC.
 *
 * UTC, not local time, because `audience_snapshots` is keyed on (channel, day)
 * and the ingest workers may run in different timezones than the analyst
 * reading the chart. A local-time key would produce duplicate or missing days
 * whenever a run crossed midnight in one zone but not the other.
 */
export function toDayString(date: Date | string | number): string {
  const d = date instanceof Date ? date : new Date(date);
  if (Number.isNaN(d.getTime())) throw new RangeError('toDayString: invalid date');
  return d.toISOString().slice(0, 10);
}
