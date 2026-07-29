/**
 * Content analysis: what the focus company publishes, against what the market
 * publishes, and which of those choices actually earn engagement.
 *
 * WHY THIS IS A SEPARATE MODULE
 * Every other query here answers "how much". These answer "what kind", which is
 * the question a social editor actually has on a Tuesday. The incumbent's
 * Social Posts screen is built almost entirely out of these, and it is the
 * densest, most useful screen in their product.
 *
 * The shape that repeats: for each dimension (hashtag, topic, post type,
 * platform, hour of day) show what the focus company does, what the landscape
 * does, and the engagement rate each earns. The comparison is the insight. A
 * bare list of your own hashtags tells you nothing; the same list against the
 * market tells you which ones you are missing.
 *
 * Everything is computed in TypeScript from one query rather than in SQL,
 * because n-gram extraction and stop-word filtering are miserable in SQL and
 * the working set is a few thousand rows.
 */
import { and, eq, gte, inArray, lte, sql } from 'drizzle-orm';
import { db } from '@/db';
import { posts, companies, landscapeCompanies, landscapes } from '@/db/schema';
import type { Platform, PostType } from '@/lib/types';

export interface DimensionRow {
  /** The hashtag, topic, post type, platform or hour label. */
  key: string;
  /** How many distinct companies in the landscape used it. */
  companies: number;
  /** Posts using it, across the landscape. */
  posts: number;
  /** Engagement rate by follower across those posts. The ranking metric. */
  engagementRateByFollower: number;
  engagementPerPost: number;
  /** True when the focus company used it at all. Drives the "you used" copy. */
  focusUsed: boolean;
  /** The focus company's own posts using it. */
  focusPosts: number;
}

export interface RateByBucket {
  bucket: number;
  focusPosts: number;
  focusRate: number;
  landscapePosts: number;
  landscapeRate: number;
}

export interface AtAGlance {
  postsPerDay: number;
  landscapePostsPerDay: number;
  engagementRateByFollower: number;
  landscapeEngagementRate: number;
  pctWithHashtags: number;
  landscapePctWithHashtags: number;
  /** Hour of day, 0-23, where the focus company's posts earn the most. */
  topHour: number | null;
  landscapeTopHour: number | null;
}

export interface ContentAnalysis {
  glance: AtAGlance;
  hashtags: DimensionRow[];
  topics: DimensionRow[];
  postTypes: DimensionRow[];
  channels: DimensionRow[];
  byHour: RateByBucket[];
  byWeekday: RateByBucket[];
  focusCompanyName: string | null;
  totalPosts: number;
}

/**
 * Words that appear in newsroom copy constantly and mean nothing as a topic.
 * Kept deliberately short: inverse document frequency does the real work, and a
 * hand-maintained list silently rots as coverage changes.
 */
const STOP = new Set([
  'the', 'a', 'an', 'and', 'or', 'but', 'of', 'to', 'in', 'on', 'at', 'for', 'with',
  'from', 'by', 'as', 'is', 'are', 'was', 'were', 'be', 'been', 'it', 'its', 'this',
  'that', 'these', 'those', 'has', 'have', 'had', 'will', 'would', 'can', 'could',
  'we', 'you', 'they', 'he', 'she', 'his', 'her', 'their', 'our', 'your', 'i',
  'not', 'no', 'more', 'most', 'now', 'here', 'there', 'what', 'when', 'who',
  'how', 'why', 'about', 'after', 'before', 'over', 'into', 'out', 'up', 'down',
  'said', 'says', 'say', 'via', 'link', 'bio', 'read', 'us', 'so', 'if', 'all',
  'one', 'two', 'get', 'got', 'just', 'also', 'than', 'then', 'them', 'were',
  // Dates and days are the most common words in news copy and never a topic.
  'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday',
  'january', 'february', 'march', 'april', 'may', 'june', 'july', 'august',
  'september', 'october', 'november', 'december', 'today', 'tomorrow',
  'yesterday', 'week', 'weekend', 'morning', 'night', 'day', 'year', 'years',
  'time', 'first', 'last', 'next', 'new', 'old', 'back', 'around', 'still',
  'people', 'man', 'woman', 'says', 'according', 'reports', 'report',
]);

/**
 * Topic candidates.
 *
 * Bigrams only, plus capitalised unigrams.
 *
 * A first version emitted every unigram and produced "time", "new", "where",
 * "july" — words that are common rather than topical, and that no editor could
 * act on. Two rules fix it. Bigrams are almost always topical because ordinary
 * words rarely co-occur consistently ("new england", "trump administration",
 * "red sox"). And a unigram earns its place only when the source capitalised
 * it, which is a free proper-noun detector: "Clancy" survives, "still" does not.
 *
 * Capitalisation is read from the ORIGINAL text, so this runs before lowercasing
 * rather than after.
 */
function phrases(text: string): string[] {
  const rawWords = text
    .replace(/https?:\/\/\S+/g, ' ')
    .replace(/[^A-Za-zÀ-ÿ0-9' ]+/g, ' ')
    .split(/\s+/)
    .filter(Boolean);

  const kept: { lower: string; capitalised: boolean }[] = [];
  for (const w of rawWords) {
    const lower = w.toLowerCase().replace(/^'+|'+$/g, '');
    if (lower.length < 3 || lower.length > 24) continue;
    if (STOP.has(lower) || /^\d+$/.test(lower)) continue;
    kept.push({ lower, capitalised: /^[A-ZÀ-Þ]/.test(w) });
  }

  const out = new Set<string>();
  for (let i = 0; i < kept.length; i += 1) {
    // A capitalised word mid-sentence is a name, a place or an institution.
    // Sentence-initial capitals are noise, but they wash out across thousands
    // of posts because the same word appears mid-sentence elsewhere.
    if (kept[i].capitalised && i > 0) out.add(kept[i].lower);
    if (i + 1 < kept.length) out.add(kept[i].lower + ' ' + kept[i + 1].lower);
  }
  return [...out];
}

interface Row {
  companyId: string;
  companyName: string;
  platform: Platform;
  type: PostType;
  postedAt: Date;
  text: string | null;
  hashtags: string[];
  engagementTotal: number;
  followersAtPost: number | null;
}

/**
 * Accumulate one dimension. `keysOf` decides what a post contributes: its
 * hashtags, its phrases, its type, its platform.
 */
function tally(
  rows: Row[],
  focusId: string | null,
  keysOf: (r: Row) => string[],
  limit: number,
  minCompanies: number,
): DimensionRow[] {
  const acc = new Map<string, {
    companies: Set<string>; posts: number; eng: number; reach: number;
    focusPosts: number;
  }>();

  for (const r of rows) {
    for (const key of keysOf(r)) {
      let e = acc.get(key);
      if (!e) { e = { companies: new Set(), posts: 0, eng: 0, reach: 0, focusPosts: 0 }; acc.set(key, e); }
      e.companies.add(r.companyId);
      e.posts += 1;
      e.eng += r.engagementTotal;
      // Rate by follower needs a denominator per post. Posts with no follower
      // reading are excluded from the rate rather than counted as infinite.
      if (r.followersAtPost && r.followersAtPost > 0) e.reach += r.followersAtPost;
      if (focusId && r.companyId === focusId) e.focusPosts += 1;
    }
  }

  // A term used by nearly every company is background vocabulary, not a topic.
  // "boston" appears in twenty of twenty-two Boston newsrooms and tells an
  // editor nothing. The interesting band is wide enough to be a real story and
  // narrow enough to be a choice, so ubiquity is excluded from the top.
  const totalCompanies = new Set(rows.map((r) => r.companyId)).size;
  const ubiquitous = Math.max(minCompanies + 1, Math.floor(totalCompanies * 0.7));

  return [...acc.entries()]
    .filter(([, e]) => e.companies.size >= minCompanies && e.companies.size <= ubiquitous)
    .map(([key, e]): DimensionRow => ({
      key,
      companies: e.companies.size,
      posts: e.posts,
      engagementRateByFollower: e.reach > 0 ? e.eng / e.reach : 0,
      engagementPerPost: e.posts > 0 ? e.eng / e.posts : 0,
      focusUsed: e.focusPosts > 0,
      focusPosts: e.focusPosts,
    }))
    .sort((a, b) => b.companies - a.companies || b.engagementRateByFollower - a.engagementRateByFollower)
    .slice(0, limit);
}

/** Focus against landscape for a time bucket, which is the shape both charts need. */
function bucketRates(rows: Row[], focusId: string | null, of: (d: Date) => number, size: number): RateByBucket[] {
  const f = Array.from({ length: size }, () => ({ posts: 0, eng: 0, reach: 0 }));
  const l = Array.from({ length: size }, () => ({ posts: 0, eng: 0, reach: 0 }));

  for (const r of rows) {
    const b = of(r.postedAt);
    if (b < 0 || b >= size) continue;
    const target = focusId && r.companyId === focusId ? f : l;
    target[b].posts += 1;
    target[b].eng += r.engagementTotal;
    if (r.followersAtPost && r.followersAtPost > 0) target[b].reach += r.followersAtPost;
  }

  return Array.from({ length: size }, (_, b) => ({
    bucket: b,
    focusPosts: f[b].posts,
    focusRate: f[b].reach > 0 ? f[b].eng / f[b].reach : 0,
    landscapePosts: l[b].posts,
    landscapeRate: l[b].reach > 0 ? l[b].eng / l[b].reach : 0,
  }));
}

export interface ContentQuery {
  landscapeId: string;
  orgId: string;
  start: Date;
  end: Date;
  platforms?: Platform[];
}

/**
 * One query, five analyses.
 *
 * The whole point is the focus-against-landscape comparison, so the focus
 * company is resolved first and every dimension is split by it. A list of your
 * own hashtags tells you nothing; the same list against the market tells you
 * which ones you are missing, which is the actionable version.
 */
export async function getContentAnalysis(q: ContentQuery): Promise<ContentAnalysis> {
  const [ls] = await db.select({ focusCompanyId: landscapes.focusCompanyId })
    .from(landscapes)
    .where(and(eq(landscapes.id, q.landscapeId), eq(landscapes.orgId, q.orgId)));
  const focusId = ls?.focusCompanyId ?? null;

  const memberIds = db.select({ id: landscapeCompanies.companyId })
    .from(landscapeCompanies)
    .where(eq(landscapeCompanies.landscapeId, q.landscapeId));

  const raw = await db
    .select({
      companyId: posts.companyId,
      companyName: companies.name,
      platform: posts.platform,
      type: posts.type,
      postedAt: posts.postedAt,
      text: posts.text,
      hashtags: posts.hashtags,
      engagementTotal: posts.engagementTotal,
      followersAtPost: posts.followersAtPost,
    })
    .from(posts)
    .innerJoin(companies, eq(posts.companyId, companies.id))
    .where(and(
      inArray(posts.companyId, memberIds),
      gte(posts.postedAt, q.start),
      lte(posts.postedAt, q.end),
      q.platforms && q.platforms.length > 0 ? inArray(posts.platform, q.platforms) : undefined,
    ));

  const rows: Row[] = raw.map((r) => ({
    ...r,
    hashtags: Array.isArray(r.hashtags) ? r.hashtags : [],
  }));

  const focusRows = focusId ? rows.filter((r) => r.companyId === focusId) : [];
  const focusName = focusRows[0]?.companyName ?? null;

  // Days in window, used for every per-day figure.
  const days = Math.max(1, Math.round((q.end.getTime() - q.start.getTime()) / 864e5));
  const companyCount = new Set(rows.map((r) => r.companyId)).size || 1;

  const rate = (list: Row[]) => {
    let eng = 0; let reach = 0;
    for (const r of list) {
      eng += r.engagementTotal;
      if (r.followersAtPost && r.followersAtPost > 0) reach += r.followersAtPost;
    }
    return reach > 0 ? eng / reach : 0;
  };

  const withTags = (list: Row[]) =>
    (list.length === 0 ? 0 : list.filter((r) => r.hashtags.length > 0).length / list.length);

  const byHour = bucketRates(rows, focusId, (d) => d.getHours(), 24);
  const byWeekday = bucketRates(rows, focusId, (d) => d.getDay(), 7);

  const bestHour = (pick: (b: RateByBucket) => number) => {
    let best: number | null = null; let bestVal = 0;
    for (const b of byHour) {
      const v = pick(b);
      if (v > bestVal) { bestVal = v; best = b.bucket; }
    }
    return best;
  };

  return {
    focusCompanyName: focusName,
    totalPosts: rows.length,
    glance: {
      postsPerDay: focusRows.length / days,
      landscapePostsPerDay: rows.length / days / companyCount,
      engagementRateByFollower: rate(focusRows),
      landscapeEngagementRate: rate(rows),
      pctWithHashtags: withTags(focusRows),
      landscapePctWithHashtags: withTags(rows),
      topHour: bestHour((b) => b.focusRate),
      landscapeTopHour: bestHour((b) => b.landscapeRate),
    },
    hashtags: tally(rows, focusId, (r) => r.hashtags.map((h) => '#' + h.toLowerCase()), 12, 2),
    topics: tally(rows, focusId, (r) => phrases(r.text ?? ''), 12, 3),
    postTypes: tally(rows, focusId, (r) => [r.type], 12, 1),
    channels: tally(rows, focusId, (r) => [r.platform], 12, 1),
    byHour,
    byWeekday,
  };
}
