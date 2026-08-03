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
import { and, eq, exists, gte, ilike, inArray, lte, or } from 'drizzle-orm';
import { db } from '@/db';
import {
  posts,
  companies,
  landscapeCompanies,
  landscapes,
  postedUrls,
  postTagAssignments,
} from '@/db/schema';
import type { Platform, PostType } from '@/lib/types';
import { daysIn, dayStrings } from '@/lib/dates';
import {
  addToFollowerRate, finishFollowerRate, followerRate, newFollowerRateAcc,
} from './follower-rate';

export interface DimensionRow {
  /** The hashtag, topic, post type, platform or hour label. */
  key: string;
  /** How many distinct companies in the landscape used it. */
  companies: number;
  /** Posts using it, across the landscape. */
  posts: number;
  /**
   * Mean of per-post engagement rates. Null when no post carried a follower
   * reading, which is not the same as a measured zero.
   */
  engagementRateByFollower: number | null;
  engagementPerPost: number;
  /** True when the focus company used it at all. Drives the "you used" copy. */
  focusUsed: boolean;
  /** The focus company's own posts using it. */
  focusPosts: number;
}

export interface RateByBucket {
  bucket: number;
  focusPosts: number;
  /** Null when no post in the bucket carried a follower reading. */
  focusRate: number | null;
  focusEngagementPerPost: number;
  landscapePosts: number;
  landscapeRate: number | null;
  landscapeEngagementPerPost: number;
}

export interface AtAGlance {
  postsPerDay: number;
  landscapePostsPerDay: number;
  engagementRateByFollower: number | null;
  landscapeEngagementRate: number | null;
  engagementPerPost: number;
  landscapeEngagementPerPost: number;
  pctWithHashtags: number;
  landscapePctWithHashtags: number;
  /** Hour of day, 0-23, when the focus company publishes most often. */
  topHour: number | null;
  landscapeTopHour: number | null;
}

export interface CompanyActivityRow {
  companyId: string;
  companyName: string;
  posts: number;
  postsPerDay: number;
  /** Null when no post carried a follower reading. Never a measured zero. */
  engagementRateByFollower: number | null;
  engagementPerPost: number;
  focus: boolean;
}

export interface ActivityPoint {
  date: string;
  focusPosts: number;
  landscapePostsPerCompany: number;
  focusRate: number;
  landscapeRate: number;
  focusEngagementPerPost: number;
  landscapeEngagementPerPost: number;
}

export interface ContentAnalysis {
  /** Inclusive number of calendar days in the selected window. */
  days: number;
  glance: AtAGlance;
  activity: CompanyActivityRow[];
  activityByDay: ActivityPoint[];
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
    companies: Set<string>; posts: number; eng: number;
    rate: ReturnType<typeof newFollowerRateAcc>;
    focusPosts: number;
  }>();

  for (const r of rows) {
    for (const key of keysOf(r)) {
      let e = acc.get(key);
      if (!e) {
        e = {
          companies: new Set(),
          posts: 0,
          eng: 0,
          rate: newFollowerRateAcc(),
          focusPosts: 0,
        };
        acc.set(key, e);
      }
      e.companies.add(r.companyId);
      e.posts += 1;
      e.eng += r.engagementTotal;
      // Rate by follower is the mean of per-post rates, not pooled engagement
      // over pooled reach. See lib/metrics/follower-rate.ts.
      addToFollowerRate(e.rate, r);
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
      engagementRateByFollower: finishFollowerRate(e.rate),
      engagementPerPost: e.posts > 0 ? e.eng / e.posts : 0,
      focusUsed: e.focusPosts > 0,
      focusPosts: e.focusPosts,
    }))
    /*
     * Selected by adoption, then RANKED by rate.
     *
     * The doc comment on DimensionRow calls the rate "the ranking metric" and
     * the screen is read that way, but the sort put company count first and let
     * rate break ties only. The top hashtags were the most widely used ones,
     * which is a different and much less useful question.
     *
     * Adoption still decides which rows are worth showing, because a term one
     * company used twice is noise however well it happened to do. So the cut is
     * by breadth and the order inside it is by performance, which is what the
     * card claims to answer. Unmeasured rows sort last, never as a zero rate.
     */
    .sort((a, b) => b.companies - a.companies || b.posts - a.posts)
    .slice(0, limit)
    .sort((a, b) => (b.engagementRateByFollower ?? -1) - (a.engagementRateByFollower ?? -1)
      || b.companies - a.companies);
}

/** Focus against landscape for a time bucket, which is the shape both charts need. */
function bucketRates(rows: Row[], focusId: string | null, of: (d: Date) => number, size: number): RateByBucket[] {
  const f = Array.from(
    { length: size },
    () => ({ posts: 0, totalEngagement: 0, rate: newFollowerRateAcc() }),
  );
  const l = Array.from(
    { length: size },
    () => ({ posts: 0, totalEngagement: 0, rate: newFollowerRateAcc() }),
  );

  for (const r of rows) {
    const b = of(r.postedAt);
    if (b < 0 || b >= size) continue;
    l[b].posts += 1;
    l[b].totalEngagement += r.engagementTotal;
    addToFollowerRate(l[b].rate, r);
    if (focusId && r.companyId === focusId) {
      f[b].posts += 1;
      f[b].totalEngagement += r.engagementTotal;
      addToFollowerRate(f[b].rate, r);
    }
  }

  return Array.from({ length: size }, (_, b) => ({
    bucket: b,
    focusPosts: f[b].posts,
    focusRate: finishFollowerRate(f[b].rate),
    focusEngagementPerPost: f[b].posts > 0
      ? f[b].totalEngagement / f[b].posts
      : 0,
    landscapePosts: l[b].posts,
    landscapeRate: finishFollowerRate(l[b].rate),
    landscapeEngagementPerPost: l[b].posts > 0
      ? l[b].totalEngagement / l[b].posts
      : 0,
  }));
}

function activityByCompany(
  rows: Row[],
  focusId: string | null,
  days: number,
): CompanyActivityRow[] {
  const acc = new Map<string, {
    companyName: string;
    posts: number;
    totalEngagement: number;
    rate: ReturnType<typeof newFollowerRateAcc>;
  }>();
  for (const row of rows) {
    const current = acc.get(row.companyId) ?? {
      companyName: row.companyName,
      posts: 0,
      totalEngagement: 0,
      rate: newFollowerRateAcc(),
    };
    current.posts += 1;
    current.totalEngagement += row.engagementTotal;
    addToFollowerRate(current.rate, row);
    acc.set(row.companyId, current);
  }
  return [...acc.entries()]
    .map(([companyId, value]): CompanyActivityRow => ({
      companyId,
      companyName: value.companyName,
      posts: value.posts,
      postsPerDay: value.posts / days,
      engagementRateByFollower: finishFollowerRate(value.rate),
      engagementPerPost: value.posts > 0 ? value.totalEngagement / value.posts : 0,
      focus: companyId === focusId,
    }))
    .sort((a, b) => b.posts - a.posts || a.companyName.localeCompare(b.companyName));
}

function activityByDay(
  rows: Row[],
  focusId: string | null,
  range: { start: Date; end: Date },
  companyCount: number,
): ActivityPoint[] {
  const acc = new Map<string, {
    focusPosts: number;
    focusTotalEngagement: number;
    focusRatedEngagement: number;
    focusFollowers: number;
    landscapePosts: number;
    landscapeTotalEngagement: number;
    landscapeRatedEngagement: number;
    landscapeFollowers: number;
  }>();
  for (const row of rows) {
    const key = easternDay(row.postedAt);
    const current = acc.get(key) ?? {
      focusPosts: 0,
      focusTotalEngagement: 0,
      focusRatedEngagement: 0,
      focusFollowers: 0,
      landscapePosts: 0,
      landscapeTotalEngagement: 0,
      landscapeRatedEngagement: 0,
      landscapeFollowers: 0,
    };
    current.landscapePosts += 1;
    current.landscapeTotalEngagement += row.engagementTotal;
    if (row.followersAtPost && row.followersAtPost > 0) {
      current.landscapeRatedEngagement += row.engagementTotal;
      current.landscapeFollowers += row.followersAtPost;
    }
    if (focusId && row.companyId === focusId) {
      current.focusPosts += 1;
      current.focusTotalEngagement += row.engagementTotal;
      if (row.followersAtPost && row.followersAtPost > 0) {
        current.focusRatedEngagement += row.engagementTotal;
        current.focusFollowers += row.followersAtPost;
      }
    }
    acc.set(key, current);
  }

  return dayStrings(range).map((date) => {
    const value = acc.get(date);
    return {
      date,
      focusPosts: value?.focusPosts ?? 0,
      landscapePostsPerCompany: (value?.landscapePosts ?? 0) / companyCount,
      focusRate: value && value.focusFollowers > 0
        ? value.focusRatedEngagement / value.focusFollowers
        : 0,
      landscapeRate: value && value.landscapeFollowers > 0
        ? value.landscapeRatedEngagement / value.landscapeFollowers
        : 0,
      focusEngagementPerPost: value && value.focusPosts > 0
        ? value.focusTotalEngagement / value.focusPosts
        : 0,
      landscapeEngagementPerPost: value && value.landscapePosts > 0
        ? value.landscapeTotalEngagement / value.landscapePosts
        : 0,
    };
  });
}

export interface ContentQuery {
  landscapeId: string;
  orgId: string;
  start: Date;
  end: Date;
  platforms?: Platform[];
  companyIds?: string[];
  postTypes?: PostType[];
  tagIds?: string[];
  search?: string;
}

const EASTERN_DAY = new Intl.DateTimeFormat('en-US', {
  timeZone: 'America/New_York',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});
const EASTERN_HOUR = new Intl.DateTimeFormat('en-US', {
  timeZone: 'America/New_York',
  hour: '2-digit',
  hourCycle: 'h23',
});
const EASTERN_WEEKDAY = new Intl.DateTimeFormat('en-US', {
  timeZone: 'America/New_York',
  weekday: 'short',
});
const WEEKDAY_INDEX: Record<string, number> = {
  Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6,
};

function easternDay(date: Date): string {
  const parts = EASTERN_DAY.formatToParts(date);
  const year = parts.find((part) => part.type === 'year')?.value ?? '0000';
  const month = parts.find((part) => part.type === 'month')?.value ?? '00';
  const day = parts.find((part) => part.type === 'day')?.value ?? '00';
  return `${year}-${month}-${day}`;
}

function easternHour(date: Date): number {
  return Number(EASTERN_HOUR.format(date));
}

function easternWeekday(date: Date): number {
  return WEEKDAY_INDEX[EASTERN_WEEKDAY.format(date)] ?? -1;
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
  const membership = await db.select({
    focusCompanyId: landscapes.focusCompanyId,
    companyId: landscapeCompanies.companyId,
  })
    .from(landscapes)
    .leftJoin(landscapeCompanies, eq(landscapeCompanies.landscapeId, landscapes.id))
    .where(and(eq(landscapes.id, q.landscapeId), eq(landscapes.orgId, q.orgId)));
  if (membership.length === 0) {
    throw new Error(
      `Landscape ${q.landscapeId} was not found in this organization. ` +
      'This is a tenancy guard, not a missing-data condition.',
    );
  }
  const landscapeFocusId = membership[0].focusCompanyId;
  const memberIds = membership.flatMap((row) => row.companyId ? [row.companyId] : []);
  const memberIdSet = new Set(memberIds);
  const scopedCompanyIds = q.companyIds?.filter((id) => memberIdSet.has(id));
  const focusId =
    scopedCompanyIds
    && scopedCompanyIds.length > 0
    && (!landscapeFocusId || !scopedCompanyIds.includes(landscapeFocusId))
      ? scopedCompanyIds[0]
      : landscapeFocusId;

  if (memberIds.length === 0) {
    return {
      days: daysIn({ start: q.start, end: q.end }),
      focusCompanyName: null,
      totalPosts: 0,
      glance: {
        postsPerDay: 0,
        landscapePostsPerDay: 0,
        engagementRateByFollower: 0,
        landscapeEngagementRate: 0,
        engagementPerPost: 0,
        landscapeEngagementPerPost: 0,
        pctWithHashtags: 0,
        landscapePctWithHashtags: 0,
        topHour: null,
        landscapeTopHour: null,
      },
      activity: [],
      activityByDay: [],
      hashtags: [],
      topics: [],
      postTypes: [],
      channels: [],
      byHour: [],
      byWeekday: [],
    };
  }

  const search = q.search?.trim();
  const searchNeedle = search ? `%${search}%` : null;
  const urlMatches = searchNeedle
    ? exists(
      db.select({ id: postedUrls.id })
        .from(postedUrls)
        .where(and(
          eq(postedUrls.postId, posts.id),
          or(
            ilike(postedUrls.url, searchNeedle),
            ilike(postedUrls.domain, searchNeedle),
            ilike(postedUrls.title, searchNeedle),
          ),
        )),
    )
    : undefined;
  const tagMatches = q.tagIds?.length
    ? exists(
      db.select({ postId: postTagAssignments.postId })
        .from(postTagAssignments)
        .where(and(
          eq(postTagAssignments.postId, posts.id),
          inArray(postTagAssignments.tagId, q.tagIds),
        )),
    )
    : undefined;

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
      scopedCompanyIds && scopedCompanyIds.length > 0
        ? inArray(posts.companyId, scopedCompanyIds)
        : undefined,
      q.postTypes && q.postTypes.length > 0 ? inArray(posts.type, q.postTypes) : undefined,
      tagMatches,
      searchNeedle
        ? or(
          ilike(posts.text, searchNeedle),
          ilike(posts.permalink, searchNeedle),
          urlMatches,
        )
        : undefined,
    ));

  const rows: Row[] = raw.map((r) => ({
    ...r,
    hashtags: Array.isArray(r.hashtags) ? r.hashtags : [],
  }));

  const focusRows = focusId ? rows.filter((r) => r.companyId === focusId) : [];
  const focusName = focusRows[0]?.companyName ?? null;

  // Days in window, used for every per-day figure.
  const days = daysIn({ start: q.start, end: q.end });
  /*
   * Divide the market by the companies that actually published, not by everyone
   * on the roster.
   *
   * This used the member count, so every company with no ingested posts still
   * took a full share of the denominator and dragged the market cadence down.
   * With Twitter's channels never having run, that understated the market by
   * roughly 1.57x and made the focus brand look 57% more prolific than its
   * peers while it was in fact at parity. The whole point of the screen is that
   * comparison.
   *
   * Falling back to the roster when nothing published at all keeps the figure
   * at zero rather than dividing by zero.
   */
  const publishingCompanies = new Set(rows.map((r) => r.companyId));
  const companyCount = Math.max(
    1,
    publishingCompanies.size > 0
      ? publishingCompanies.size
      : (scopedCompanyIds && scopedCompanyIds.length > 0
        ? scopedCompanyIds.length
        : memberIds.length),
  );

  const rate = (list: Row[]) => followerRate(list).rate;
  const engagementPerPost = (list: Row[]) => list.length > 0
    ? list.reduce((sum, row) => sum + row.engagementTotal, 0) / list.length
    : 0;

  const withTags = (list: Row[]) =>
    (list.length === 0 ? 0 : list.filter((r) => r.hashtags.length > 0).length / list.length);

  const byHour = bucketRates(rows, focusId, easternHour, 24);
  const byWeekday = bucketRates(rows, focusId, easternWeekday, 7);

  const bestHour = (pick: (b: RateByBucket) => number) => {
    let best: number | null = null; let bestVal = 0;
    for (const b of byHour) {
      const v = pick(b);
      if (v > bestVal) { bestVal = v; best = b.bucket; }
    }
    return best;
  };

  return {
    days,
    focusCompanyName: focusName,
    totalPosts: rows.length,
    activity: activityByCompany(rows, focusId, days),
    activityByDay: activityByDay(
      rows,
      focusId,
      { start: q.start, end: q.end },
      companyCount,
    ),
    glance: {
      postsPerDay: focusRows.length / days,
      landscapePostsPerDay: rows.length / days / companyCount,
      engagementRateByFollower: rate(focusRows),
      landscapeEngagementRate: rate(rows),
      engagementPerPost: engagementPerPost(focusRows),
      landscapeEngagementPerPost: engagementPerPost(rows),
      pctWithHashtags: withTags(focusRows),
      landscapePctWithHashtags: withTags(rows),
      topHour: bestHour((b) => b.focusPosts),
      landscapeTopHour: bestHour((b) => b.landscapePosts),
    },
    hashtags: tally(rows, focusId, (r) => r.hashtags.map((h) => '#' + h.toLowerCase()), 12, 2),
    topics: tally(rows, focusId, (r) => phrases(r.text ?? ''), 12, 3),
    postTypes: tally(rows, focusId, (r) => [r.type], 12, 1),
    channels: tally(rows, focusId, (r) => [r.platform], 12, 1),
    byHour,
    byWeekday,
  };
}
