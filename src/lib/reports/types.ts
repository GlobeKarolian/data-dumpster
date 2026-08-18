/**
 * The shape of a weekly report.
 *
 * The whole design turns on one split. A section is either COMPUTED, meaning it
 * is derived from ingested data and regenerated on demand, or MANUAL, meaning it
 * lives in a system Data Dumpster does not read and is pasted in by a human. A
 * third layer, NARRATIVE, is the so-what commentary that sits above both.
 *
 * Nothing computed is editable, on purpose. The failure mode this replaces is a
 * Google Doc where last week's follower count survived a copy-paste and nobody
 * noticed for a month. If a number can be recomputed it must be recomputed, and
 * if it cannot be recomputed it must be visibly hand-entered. There is no third
 * category of number that looks automatic but is not.
 *
 * Every block below is a `type` rather than an `interface` so it stays
 * assignable to the jsonb columns, which are typed as Record<string, unknown>.
 */
import type { Platform, PostType } from '@/lib/types';

/**
 * The platforms the owned-brand table reports on, in artefact order.
 *
 * Threads, Bluesky and LinkedIn were missing from the original five and should
 * not have been. A supported platform must not disappear from the executive
 * table merely because it was added after that table was first designed.
 *
 * Reddit is here on one channel with no posts yet. An empty column is the
 * correct thing to show: it says the channel is tracked and not collecting,
 * which is a fault worth seeing rather than an absence worth hiding.
 */
export const REPORT_PLATFORMS = [
  'facebook', 'instagram', 'linkedin', 'youtube', 'twitter', 'tiktok', 'threads', 'bluesky', 'reddit',
  'truth_social',
] as const;
export type ReportPlatform = (typeof REPORT_PLATFORMS)[number];

export const REPORT_PLATFORM_LABELS: Record<ReportPlatform, string> = {
  facebook: 'Facebook',
  instagram: 'Instagram',
  linkedin: 'LinkedIn',
  youtube: 'YouTube',
  twitter: 'X',
  tiktok: 'TikTok',
  threads: 'Threads',
  bluesky: 'Bluesky',
  reddit: 'Reddit',
  truth_social: 'Truth Social',
};

/** Which way a figure moved. 'unknown' when there was no comparable baseline. */
export type Direction = 'up' | 'down' | 'flat' | 'unknown';

export type Movement = {
  value: number | null;
  previousValue: number | null;
  /** Fractional, so 0.27 is +27 percent. Null against a zero baseline. */
  changePct: number | null;
  direction: Direction;
};

export type BrandRow = {
  companyId: string;
  name: string;
  /** Membership in the organization-private BGM portfolio landscape. */
  isBgmOwned?: boolean;
  rank: number | null;
  totalFollowers: number | null;
  previousTotalFollowers: number | null;
  /** Followers gained inside the window, last observation minus first. */
  netChange: number | null;
  /**
   * The audience endpoints behind `netChange` came from a source that had
   * already rounded them, so the movement may be a bucket flip rather than
   * growth. Kept visible and marked; see lib/metrics/source-rounding.
   */
  netChangeFromRoundedSource?: boolean;
  changePct: number | null;
  byPlatform: Partial<Record<ReportPlatform, number>>;
  /** Signed follower change by platform for the report window. */
  netChangeByPlatform?: Partial<Record<ReportPlatform, number>>;
  /** Publishing and engagement metrics used by the visual brand scorecards. */
  posts?: number | null;
  postsChangePct?: number | null;
  engagementTotal?: number | null;
  /** Total engagement during the window, split by platform. */
  engagementByPlatform?: Partial<Record<ReportPlatform, number>>;
  /** Captured video views during the window; unsupported sources do not contribute. */
  viewsTotal?: number | null;
  /** Captured video views split by platforms that reported the metric. */
  viewsByPlatform?: Partial<Record<ReportPlatform, number>>;
  engagementChangePct?: number | null;
  engagementRateByFollower?: number | null;
  engagementRateChangePct?: number | null;
  topEngagementPlatform?: ReportPlatform | null;
};

export type TopPost = {
  id: string;
  rank: number;
  companyName: string;
  platform: Platform;
  type?: PostType;
  postedAt: string;
  text: string | null;
  permalink: string | null;
  thumbnailUrl?: string | null;
  engagementTotal: number;
  isBgmOwned?: boolean;
};

export type CohortRow = {
  companyId: string;
  name: string;
  rank: number;
  engagementTotal: number;
  changePct: number | null;
  isFocus: boolean;
  /** True for every company in the BGM landscape, not only the focus company. */
  isBgmOwned?: boolean;
};

export type CohortSummary = {
  landscapeName: string;
  focusCompanyName: string | null;
  focusRank: number | null;
  memberCount: number;
  engagement: Movement;
  rows: CohortRow[];
  /** Best rank a focus-company post reached in the landscape-wide top posts. */
  focusPostRank: number | null;
  /** How many posts that ranking was drawn from, so the rank is readable. */
  focusPostPool: number;
};

export type FocusPerformance = {
  companyName: string | null;
  followers: Movement;
  netFollowers: number | null;
  previousNetFollowers: number | null;
  engagementTotal: Movement;
  posts: Movement;
  engagementPerPost: Movement;
};

export type PortfolioPerformance = {
  /**
   * New report snapshots explicitly identify this as the BGM-owned portfolio.
   * Older snapshots omitted the field and used the whole landscape, so the UI
   * derives a safe BGM-only fallback from their saved brand rows.
   */
  scope?: 'bgm_owned';
  followers: Movement;
  netFollowers: number | null;
  previousNetFollowers?: number | null;
  engagementTotal: Movement;
  posts: Movement;
  engagementPerPost: Movement;
};

export type ComputedBlock = {
  version: 1;
  /** When this block was last derived. Rendered next to every computed figure. */
  generatedAt: string;
  landscape: { id: string; name: string };
  period: { start: string; end: string };
  previousPeriod: { start: string; end: string };
  /** The focus brand of the landscape, which is what the exec summary leads on. */
  focus: FocusPerformance;
  /** Every measured BGM-owned brand in this landscape, added up. */
  portfolio: PortfolioPerformance;
  brands: BrandRow[];
  topPosts: TopPost[];
  /** Highest-engagement posts restricted to BGM portfolio companies. */
  bgmTopPosts?: TopPost[];
  cohort: CohortSummary;
  /** Measurement caveats from the metrics layer. Surfaced, never swallowed. */
  caveats: string[];
};

/* ------------------------------------------------------------------ manual */

export type ManualColumnSpec = {
  key: string;
  label: string;
  /** Right-aligned and tabular in every rendering, including the export. */
  numeric?: boolean;
};

/**
 * A file format this section can ingest directly, in addition to pasting.
 *
 * Some exports cannot survive a clipboard round trip. An Adobe Freeform CSV
 * holds several stacked tables with two-row headers, so selecting it in a
 * browser and copying gives a shape no delimiter sniffer can recover. Those
 * sections take the file itself.
 */
export type ManualImporter = 'adobeFreeform' | 'searchScreenshot';

export type ManualSectionSpec = {
  id: string;
  title: string;
  /** Where the human actually gets this data. Shown above the paste box. */
  hint: string;
  columns: ManualColumnSpec[];
  /** When set, the section also accepts a dropped file of this format. */
  importer?: ManualImporter;
  /**
   * What the imported table ranks on. Defaults to subscriptions.
   *
   * Properties without a meaningful subscription metric rank by traffic
   * instead, and their import refuses to require a subscriptions column.
   */
  importRank?: 'subscriptions' | 'visits';
  /** Shown next to the drop zone so the expected export is unambiguous. */
  importHint?: string;
};

/**
 * One pasted table. `raw` is kept verbatim so a re-parse is always possible and
 * an unrecognised paste is never silently destroyed; `rows` is what renders.
 */
export type ManualTable = {
  raw: string;
  rows: string[][];
  updatedAt: string | null;
  /** Optional human-auditable report URL associated with this table. */
  sourceUrl?: string;
  /**
   * What a rolled-up row is made of, keyed by its first cell.
   *
   * The referral import folds hostnames into platforms, so "Reddit 8,423" is
   * reddit.com plus com.reddit and matches neither number in Adobe. That was
   * caught by eye, which is one time too many. It lives in its own field rather
   * than a trailing column because parseTable truncates every row to the
   * section's column count, so a hidden column would be destroyed the moment
   * anyone touched the paste box.
   */
  breakdown?: Record<string, string[]>;
};

export type ManualBlock = Record<string, ManualTable>;

/**
 * External report sections. Search Console can be synchronized through its
 * official API; the referral report, paid dashboard and Apple News remain
 * explicit human inputs. Every section retains a paste fallback so an upstream
 * outage never forces someone to rebuild a report elsewhere.
 */
export const MANUAL_SECTIONS: ManualSectionSpec[] = [
  {
    id: 'globeSearch',
    title: 'Globe.com Top Web Searches Sorted By URL Clicks',
    hint: 'Drop screenshots of the Globe.com Looker Studio table, review the OCR, and use every extracted row. Paste remains available as a fallback.',
    importer: 'searchScreenshot',
    importHint: 'Include Query, URL Clicks, Impressions, and URL CTR in each screenshot. Comparison columns are allowed.',
    columns: [
      { key: 'query', label: 'Search Query' },
      { key: 'clicks', label: 'URL Clicks', numeric: true },
      { key: 'impressions', label: 'Impressions', numeric: true },
      { key: 'ctr', label: 'CTR', numeric: true },
    ],
  },
  {
    id: 'bostonSearch',
    title: 'Boston.com Top Web Searches Sorted By URL Clicks',
    hint: 'Drop screenshots of the Boston.com Looker Studio table, review the OCR, and use every extracted row. Paste remains available as a fallback.',
    importer: 'searchScreenshot',
    importHint: 'Include Query, URL Clicks, Impressions, and URL CTR in each screenshot. Comparison columns are allowed.',
    columns: [
      { key: 'query', label: 'Search Query' },
      { key: 'clicks', label: 'URL Clicks', numeric: true },
      { key: 'impressions', label: 'Impressions', numeric: true },
      { key: 'ctr', label: 'CTR', numeric: true },
    ],
  },
  {
    id: 'globeReferral',
    title: 'Globe.com Platform Referral Traffic Sorted By Subscriptions Driven',
    hint: 'Adobe Analytics, Top referrals for the Bostonglobe.com report suite. '
      + 'Drop the export below rather than pasting it.',
    importer: 'adobeFreeform',
    importHint: 'CSV or Excel, straight from Adobe. Several stacked tables in one file is '
      + 'expected, and every sheet is searched; the referring-domain table is found for you.',
    columns: [
      { key: 'platform', label: 'Platform' },
      { key: 'visits', label: 'Logged-out visits', numeric: true },
      // Adobe calls this "BG Digital Subscriptions (Visit)". "(Visit)" is its
      // attribution scope, not the unit; the figure counts NEW subscriptions
      // started. The Adobe wording is not carried through because reading it as
      // subscriber visits understates every referrer by three orders of magnitude.
      { key: 'subs', label: 'New subscriptions', numeric: true },
      { key: 'conversion', label: 'Conversion', numeric: true },
    ],
  },
  {
    id: 'bostonReferral',
    title: 'Boston.com Platform Referral Traffic Sorted By Visits',
    hint: 'Adobe Analytics, Top referrals for the Boston.com report suite. '
      + 'Drop the export below rather than pasting it.',
    importer: 'adobeFreeform',
    // Boston.com is not a subscription product. Its "Bcom Digital
    // Subscriptions" metric recorded four for the whole week, three of them
    // arriving from a bostonglobe.com link, so the section reports traffic.
    importRank: 'visits',
    importHint: 'CSV or Excel, straight from Adobe. Subscriptions are not reported for '
      + 'Boston.com; the section ranks referral traffic.',
    columns: [
      { key: 'platform', label: 'Platform' },
      { key: 'visits', label: 'Visits', numeric: true },
      { key: 'share', label: 'Share of referred', numeric: true },
    ],
  },
  {
    id: 'statReferral',
    title: 'STATNews.com Platform Referral Traffic Sorted By Visits',
    hint: 'Adobe Analytics, Top referrals for the STAT report suite. '
      + 'Drop the export below rather than pasting it.',
    importer: 'adobeFreeform',
    importRank: 'visits',
    importHint: 'CSV or Excel, straight from Adobe. The section ranks referral traffic.',
    columns: [
      { key: 'platform', label: 'Platform' },
      { key: 'visits', label: 'Visits', numeric: true },
      { key: 'share', label: 'Share of referred', numeric: true },
    ],
  },
];

/**
 * Single figures rather than tables. Paid promotion and Apple News are two or
 * four numbers each in the artefact, and a five-row paste box for them would be
 * ceremony. They are still manual, and still labelled as such.
 */
export type ManualFigureSpec = {
  id: string;
  group: 'paid' | 'appleNews';
  label: string;
  hint: string;
  format: 'integer' | 'usd' | 'text';
};

export const MANUAL_FIGURES: ManualFigureSpec[] = [
  {
    id: 'paidStarts', group: 'paid', format: 'integer',
    label: 'Subscription starts, year to date',
    hint: 'Paid acquisition dashboard, cumulative starts attributed to promotion.',
  },
  {
    id: 'paidCostPerStart', group: 'paid', format: 'usd',
    label: 'Blended cost per start',
    hint: 'Total promotion spend divided by starts, year to date.',
  },
  {
    id: 'appleUniqueViewers', group: 'appleNews', format: 'integer',
    label: 'Unique viewers',
    hint: 'Apple News Publisher, Boston.com channel, this week.',
  },
  {
    id: 'appleReach', group: 'appleNews', format: 'integer',
    label: 'Reach',
    hint: 'Apple News Publisher, Boston.com channel, this week.',
  },
  {
    id: 'appleShares', group: 'appleNews', format: 'integer',
    label: 'Shares',
    hint: 'Apple News Publisher, Boston.com channel, this week.',
  },
  {
    id: 'appleEngagedMinutes', group: 'appleNews', format: 'integer',
    label: 'Apple News+ engaged minutes',
    hint: 'Apple News Publisher, News+ engagement report.',
  },
];

/** The full contents of the `manual` jsonb column. */
export type ManualState = {
  tables: ManualBlock;
  figures: Record<string, string>;
};

/* --------------------------------------------------------------- narrative */

export type NarrativeSectionSpec = {
  id: string;
  title: string;
  /** What this paragraph is for. Also handed to the model as the brief. */
  guidance: string;
  /** Which computed and manual material the AI draft is allowed to see. */
  sources: { computed: boolean; manualTables: string[]; manualFigures: string[] };
};

export type NarrativeBlock = Record<string, string>;

/**
 * The CEO's standing instruction is that the report answers so-what and never
 * ships a naked table. Narrative is therefore a first-class field on every
 * section rather than a free-text box at the bottom nobody fills in.
 */
export const NARRATIVE_SECTIONS: NarrativeSectionSpec[] = [
  {
    id: 'executiveSummary',
    title: 'Executive Summary',
    guidance:
      'Three to five sentences a chief executive can read standing up. Lead with the '
      + 'direction of travel, name the one number that changed most, and say what it means '
      + 'for next week. No lists.',
    sources: { computed: true, manualTables: [], manualFigures: ['paidStarts', 'paidCostPerStart'] },
  },
  {
    id: 'brands',
    title: 'Owned Brands',
    guidance:
      'Explain the movement in the brand table. Which brand grew, which shrank, and '
      + 'whether the shift is platform-specific rather than brand-specific.',
    sources: { computed: true, manualTables: [], manualFigures: [] },
  },
  {
    id: 'search',
    title: 'Web Search',
    guidance:
      'Put the search queries in perspective. What subject drove clicks, is it recurring '
      + 'or a one-week spike, and does it match what the newsroom was publishing.',
    sources: { computed: false, manualTables: ['globeSearch', 'bostonSearch'], manualFigures: [] },
  },
  {
    id: 'referral',
    title: 'Platform Referral Traffic',
    guidance:
      'Referral is a subscription funnel, not a traffic table. Say which domains send '
      + 'visits and which send subscribers, and call out where those two disagree.',
    sources: {
      computed: false,
      manualTables: ['globeReferral', 'bostonReferral', 'statReferral'],
      manualFigures: [],
    },
  },
  {
    id: 'paid',
    title: 'Paid Promotion and Apple News',
    guidance:
      'Interpret cost per start against the trend, and say whether Apple News reach is '
      + 'translating into engaged time or only impressions.',
    sources: {
      computed: false,
      manualTables: [],
      manualFigures: [
        'paidStarts', 'paidCostPerStart', 'appleUniqueViewers',
        'appleReach', 'appleShares', 'appleEngagedMinutes',
      ],
    },
  },
  {
    id: 'cohort',
    title: 'Boston News Landscape',
    guidance:
      'Where the newsroom sits against the local cohort this week, whether the gap is '
      + 'widening or closing, and what a competitor did that is worth copying.',
    sources: { computed: true, manualTables: [], manualFigures: [] },
  },
];

/* ------------------------------------------------------------- jsonb reads */

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/**
 * Read a computed block back out of jsonb.
 *
 * Returns null rather than a half-populated object when the shape is not the
 * current version. A report written by an older build gets a "recompute to see
 * these figures" state, which is the honest answer; coercing unknown JSON into
 * a ComputedBlock would put numbers on screen that nothing produced.
 */
export function readComputed(value: unknown): ComputedBlock | null {
  if (!isRecord(value)) return null;
  if (value.version !== 1) return null;
  if (!isRecord(value.focus) || !Array.isArray(value.brands)) return null;
  return value as unknown as ComputedBlock;
}

export function emptyManualState(): ManualState {
  return { tables: {}, figures: {} };
}

/** Tolerant by design: a manual block is user data, and partial is normal. */
export function readManual(value: unknown): ManualState {
  if (!isRecord(value)) return emptyManualState();
  const tables: ManualBlock = {};
  if (isRecord(value.tables)) {
    for (const [key, raw] of Object.entries(value.tables)) {
      if (!isRecord(raw)) continue;
      const rows = Array.isArray(raw.rows)
        ? raw.rows
          .filter((r): r is unknown[] => Array.isArray(r))
          .map((r) => r.map((cell) => (typeof cell === 'string' ? cell : String(cell ?? ''))))
        : [];
      const breakdown: Record<string, string[]> = {};
      if (isRecord(raw.breakdown)) {
        for (const [label, parts] of Object.entries(raw.breakdown)) {
          if (!Array.isArray(parts)) continue;
          breakdown[label] = parts.filter((p): p is string => typeof p === 'string');
        }
      }
      tables[key] = {
        raw: typeof raw.raw === 'string' ? raw.raw : '',
        rows,
        updatedAt: typeof raw.updatedAt === 'string' ? raw.updatedAt : null,
        ...(typeof raw.sourceUrl === 'string' ? { sourceUrl: raw.sourceUrl } : {}),
        ...(Object.keys(breakdown).length > 0 ? { breakdown } : {}),
      };
    }
  }
  const figures: Record<string, string> = {};
  if (isRecord(value.figures)) {
    for (const [key, raw] of Object.entries(value.figures)) {
      if (typeof raw === 'string') figures[key] = raw;
    }
  }
  return { tables, figures };
}

export function readNarrative(value: unknown): NarrativeBlock {
  if (!isRecord(value)) return {};
  const out: NarrativeBlock = {};
  for (const [key, raw] of Object.entries(value)) {
    if (typeof raw === 'string') out[key] = raw;
  }
  return out;
}

/* ------------------------------------------------------------- the window */

export type Period = { start: string; end: string };

function toDay(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return y + '-' + m + '-' + day;
}

/**
 * The last complete Monday-to-Sunday window.
 *
 * The report is written on a Monday about the week that just ended, so the
 * default must never include today: a partial week silently averaged into a
 * weekly figure is exactly the class of error this tool exists to remove.
 */
export function lastCompleteWeek(now = new Date()): Period {
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  // Monday is 0 in this rotation, so subtracting lands on the current Monday.
  const sinceMonday = (today.getDay() + 6) % 7;
  const thisMonday = new Date(today);
  thisMonday.setDate(today.getDate() - sinceMonday);
  const start = new Date(thisMonday);
  start.setDate(thisMonday.getDate() - 7);
  const end = new Date(start);
  end.setDate(start.getDate() + 6);
  return { start: toDay(start), end: toDay(end) };
}

/** "Platforms Dashboard and Digest, 7/20/2026 - 7/26/2026" style. */
export function periodLabel(period: Period): string {
  const fmt = (iso: string) => {
    const [y, m, d] = iso.split('-').map(Number);
    if (!y || !m || !d) return iso;
    return m + '/' + d + '/' + y;
  };
  return fmt(period.start) + ' - ' + fmt(period.end);
}

export function defaultReportTitle(period: Period): string {
  return 'Platforms Dashboard and Digest, ' + periodLabel(period);
}
