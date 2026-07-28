/**
 * The metric dictionary.
 *
 * Every number Pressbox puts on screen resolves to exactly one entry here, and the
 * UI renders `description` in a tooltip on hover. That is deliberate: a competitive
 * analytics tool that will not tell an executive how it computed a figure is a tool
 * nobody trusts twice. Descriptions are written for a smart newsroom leader who has
 * to defend the number in a meeting -- not for the engineer who wrote the SQL.
 *
 * `formula` is the plain-language arithmetic. `precision` is how many decimals to
 * show. `unit` drives formatting: 'count' renders as a whole number with thousands
 * separators, 'rate' as a decimal, 'percent' as value x 100 with a % sign.
 */
import { METRIC_KEYS, type MetricKey } from '@/lib/types';

export type MetricUnit = 'count' | 'rate' | 'percent';

export interface MetricDef {
  key: MetricKey;
  /** Full name, used in headings and tooltips. */
  label: string;
  /** Compact name for table headers and chart axes. */
  shortLabel: string;
  /** Tooltip copy. Written for a newsroom executive. */
  description: string;
  /** The arithmetic, in words. Shown under the description. */
  formula: string;
  unit: MetricUnit;
  /** Sort direction for leaderboards: true means rank 1 is the largest value. */
  higherIsBetter: boolean;
  /** Decimal places to display. */
  precision: number;
  /** Shown as a warning note when the metric is used in a comparison. */
  caveat?: string;
}

export const METRIC_DEFS: Record<MetricKey, MetricDef> = {
  audience: {
    key: 'audience',
    label: 'Audience',
    shortLabel: 'Audience',
    description:
      'The total size of a company’s following across every channel in view, as of the most recent day in the selected window. This is a snapshot, not an accumulation: it answers "how many people can they reach today," not "how many followers did they gain."',
    formula: 'Sum of the latest follower count for each channel inside the window',
    unit: 'count',
    higherIsBetter: true,
    precision: 0,
    caveat:
      'Audience is a stock, not a flow. Widening the date range does not make this number bigger — it only changes which day the snapshot is taken from.',
  },
  audienceNetChange: {
    key: 'audienceNetChange',
    label: 'Audience Net Change',
    shortLabel: 'Net Change',
    description:
      'Followers gained or lost across the window. Negative values are real and are shown as such; platforms purge bot accounts and audiences do shrink.',
    formula: 'Audience on the last day in the window minus audience on the first day',
    unit: 'count',
    higherIsBetter: true,
    precision: 0,
    caveat:
      'A large brand adding 5,000 followers and a small brand adding 5,000 followers are not the same achievement. Use Audience Growth Rate to compare across sizes.',
  },
  audienceGrowthRate: {
    key: 'audienceGrowthRate',
    label: 'Audience Growth Rate',
    shortLabel: 'Growth Rate',
    description:
      'How fast the following grew over the window, in percentage terms. This is the size-neutral version of Net Change and is the fair way to compare a 40,000-follower newsletter brand against a 4,000,000-follower national outlet.',
    formula: '(Audience at end − Audience at start) ÷ Audience at start',
    unit: 'percent',
    higherIsBetter: true,
    precision: 2,
    caveat:
      'Undefined when a company had no measured audience at the start of the window; Pressbox shows a blank rather than an artificially enormous percentage.',
  },
  posts: {
    key: 'posts',
    label: 'Posts',
    shortLabel: 'Posts',
    description:
      'How many times the company published inside the window, across the channels and post types currently filtered. This is the denominator behind most efficiency metrics, so check it before reading anything into a per-post average.',
    formula: 'Count of posts published inside the window',
    unit: 'count',
    higherIsBetter: true,
    precision: 0,
    caveat:
      'Volume is not virtue. A company can lead on Posts and trail on every engagement metric — read this alongside Engagement per Post.',
  },
  postsPerDay: {
    key: 'postsPerDay',
    label: 'Posts per Day',
    shortLabel: 'Posts/Day',
    description:
      'Publishing cadence, normalized so a 7-day window and a 90-day window can sit in the same table. Useful for spotting whether a competitor has quietly doubled their output.',
    formula: 'Posts ÷ number of days in the window',
    unit: 'rate',
    higherIsBetter: true,
    precision: 2,
  },
  postsPerWeek: {
    key: 'postsPerWeek',
    label: 'Posts per Week',
    shortLabel: 'Posts/Week',
    description:
      'The same cadence figure expressed weekly, which is how most newsroom social calendars are actually planned.',
    formula: '(Posts ÷ days in the window) × 7',
    unit: 'rate',
    higherIsBetter: true,
    precision: 1,
  },
  engagementTotal: {
    key: 'engagementTotal',
    label: 'Total Engagement',
    shortLabel: 'Engagement',
    description:
      'Every measurable audience reaction added together — likes and reactions, comments and replies, shares and reposts, and saves. It is the single best answer to "how much did their content actually move."',
    formula: 'Applause + Conversation + Amplification + Saves, summed over all posts in the window',
    unit: 'count',
    higherIsBetter: true,
    precision: 0,
    caveat:
      'Platforms expose different reaction types, so a company that is heavy on one network is not strictly comparable to one that is heavy on another. Filter to a single platform for a clean read.',
  },
  engagementPerPost: {
    key: 'engagementPerPost',
    label: 'Engagement per Post',
    shortLabel: 'Eng/Post',
    description:
      'The average reaction a single piece of content earns. This separates outlets that publish well from outlets that simply publish a lot.',
    formula: 'Total Engagement ÷ Posts',
    unit: 'rate',
    higherIsBetter: true,
    precision: 1,
    caveat:
      'Still scales with audience size — a bigger following earns more reactions per post almost by default. For cross-company fairness use Engagement Rate by Follower.',
  },
  engagementRateByFollower: {
    key: 'engagementRateByFollower',
    label: 'Engagement Rate by Follower',
    shortLabel: 'Eng Rate',
    description:
      'The share of a company’s following that reacts to a typical post. Roughly: of everyone who could have seen this, what fraction did something about it. Industry benchmarks for news brands sit in the low tenths of a percent, so small absolute differences here are meaningful.',
    formula: 'Total Engagement ÷ Followers ÷ Posts, computed per platform and then combined',
    unit: 'percent',
    higherIsBetter: true,
    precision: 3,
    caveat:
      'This is the only metric in Pressbox that is genuinely fair to compare across companies with very different audience sizes. Every other engagement figure — Total Engagement, Engagement per Post, Applause, Views — scales with how many followers a brand already has, so a national outlet will out-rank a metro daily on those regardless of how good the content is. Engagement Rate by Follower divides that advantage back out, which is why it is the metric to lead with when a 4M-follower account and a 40K-follower account appear in the same landscape. Two honest limits: it is undefined for any channel with no follower reading, and it can flatter very small accounts whose handful of loyal followers all engage.',
  },
  engagementRateByView: {
    key: 'engagementRateByView',
    label: 'Engagement Rate by View',
    shortLabel: 'Eng/View',
    description:
      'Of the people who actually saw the content, what fraction reacted. On video-first platforms this is a truer read on content quality than follower-based rates, because reach there is driven by recommendation rather than by who follows you.',
    formula: 'Total Engagement ÷ Total Views',
    unit: 'percent',
    higherIsBetter: true,
    precision: 2,
    caveat:
      'Only meaningful where the platform reports views. Facebook, Instagram, TikTok and YouTube do; text-first networks largely do not, so this metric goes blank for them rather than reporting a misleading zero.',
  },
  applause: {
    key: 'applause',
    label: 'Applause',
    shortLabel: 'Applause',
    description:
      'The low-effort approval signal: likes, favorites, hearts, upvotes, reactions. Cheap to give, which makes it a decent proxy for reach but a weak proxy for genuine interest.',
    formula: 'Sum of likes and equivalent reactions across posts in the window',
    unit: 'count',
    higherIsBetter: true,
    precision: 0,
  },
  conversation: {
    key: 'conversation',
    label: 'Conversation',
    shortLabel: 'Comments',
    description:
      'Comments and replies. The most expensive reaction a reader can give, and therefore the most telling — though note that a spike here can mean a story struck a nerve rather than that it landed well.',
    formula: 'Sum of comments and replies across posts in the window',
    unit: 'count',
    higherIsBetter: true,
    precision: 0,
    caveat:
      'Volume of conversation carries no sentiment. A comment surge deserves a look at the actual thread before it goes in a deck.',
  },
  amplification: {
    key: 'amplification',
    label: 'Amplification',
    shortLabel: 'Shares',
    description:
      'Shares, retweets, reposts and quotes — the reactions that put content in front of people who do not already follow you. This is the growth engine metric.',
    formula: 'Sum of shares, reposts and quotes across posts in the window',
    unit: 'count',
    higherIsBetter: true,
    precision: 0,
  },
  saves: {
    key: 'saves',
    label: 'Saves',
    shortLabel: 'Saves',
    description:
      'Bookmarks and saves. A quiet but strong signal of utility — readers save what they intend to come back to, which is exactly what service journalism is for.',
    formula: 'Sum of saves and bookmarks across posts in the window',
    unit: 'count',
    higherIsBetter: true,
    precision: 0,
    caveat:
      'Reported by only a few platforms (Instagram, TikTok, and X for some account types). A zero here usually means "not reported," not "nobody saved it."',
  },
  views: {
    key: 'views',
    label: 'Views',
    shortLabel: 'Views',
    description:
      'How many times the content was played or displayed. The closest thing to a reach figure that public APIs expose.',
    formula: 'Sum of views and plays across posts in the window',
    unit: 'count',
    higherIsBetter: true,
    precision: 0,
    caveat:
      'Every platform counts a view differently — a 3-second autoplay and a completed watch can both count as one. Compare views within a platform, not across them.',
  },
  viewsPerPost: {
    key: 'viewsPerPost',
    label: 'Views per Post',
    shortLabel: 'Views/Post',
    description:
      'Average reach of a single piece of content. Useful for judging whether a competitor’s jump in total views came from better content or simply from posting more.',
    formula: 'Total Views ÷ Posts',
    unit: 'rate',
    higherIsBetter: true,
    precision: 0,
  },
  shareOfVoice: {
    key: 'shareOfVoice',
    label: 'Share of Voice',
    shortLabel: 'SOV',
    description:
      'This company’s slice of everything published in the landscape during the window. It answers "how much of the conversation are we even in."',
    formula: 'Company posts ÷ all posts by every company in the landscape',
    unit: 'percent',
    higherIsBetter: true,
    precision: 1,
    caveat:
      'Entirely dependent on who is in the landscape. Adding or removing a competitor changes everyone’s number without anyone changing behavior.',
  },
  shareOfEngagement: {
    key: 'shareOfEngagement',
    label: 'Share of Engagement',
    shortLabel: 'SOE',
    description:
      'This company’s slice of all audience reaction in the landscape. Read it next to Share of Voice: earning a larger share of engagement than of posting is the definition of punching above your weight.',
    formula: 'Company engagement ÷ all engagement by every company in the landscape',
    unit: 'percent',
    higherIsBetter: true,
    precision: 1,
    caveat:
      'Like Share of Voice, this moves when the competitive set changes. Always cite the landscape alongside the figure.',
  },
};

/** Stable display order, matching METRIC_KEYS. */
export const METRIC_LIST: MetricDef[] = METRIC_KEYS.map((k) => METRIC_DEFS[k]);

export function getMetricDef(key: MetricKey): MetricDef {
  return METRIC_DEFS[key];
}
