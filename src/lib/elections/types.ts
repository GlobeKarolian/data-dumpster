import type { MetricRow, Platform } from '@/lib/types';
import type { PostDto, TimeSeriesResult } from '@/lib/metrics/contract';

export type ElectionRaceStatus = 'setup' | 'active' | 'archived';
export type ElectionCandidateStatus = 'tracking' | 'declared' | 'filed' | 'withdrawn';

export interface ElectionRaceSummary {
  id: string;
  landscapeId: string;
  name: string;
  slug: string;
  office: string;
  jurisdiction: string;
  electionDate: string | null;
  status: ElectionRaceStatus;
  description: string | null;
  candidateCount: number;
  profileCount: number;
  platformCount: number;
  lastIngestedAt: string | null;
}

export interface ElectionCandidateProfile {
  id: string;
  platform: Platform;
  handle: string;
  profileUrl: string | null;
  avatarUrl: string | null;
  active: boolean;
  lastIngestedAt: string | null;
}

export type ElectionProfileSourceStatus =
  | 'pending'
  | 'connecting'
  | 'connected'
  | 'review'
  | 'paused'
  | 'skipped'
  | 'error';

export interface ElectionCandidateSource {
  id: string;
  platform: Platform;
  url: string;
  /** Editor-supplied account disambiguation, e.g. "personal" vs "campaign". */
  label: string | null;
  status: ElectionProfileSourceStatus;
  channelId: string | null;
  note: string | null;
}

export interface ElectionCandidateRecord {
  id: string;
  companyId: string;
  name: string;
  website: string | null;
  logoUrl: string | null;
  color: string | null;
  currentRole: string | null;
  party: string | null;
  status: ElectionCandidateStatus;
  incumbent: boolean | null;
  profiles: ElectionCandidateProfile[];
  sources: ElectionCandidateSource[];
}

export interface ElectionRaceDetail extends ElectionRaceSummary {
  candidates: ElectionCandidateRecord[];
}

/**
 * Code-computed facts for the visual race tracker. The client only arranges
 * these values; it never derives campaign performance from source setup state.
 */
export interface ElectionRaceAnalytics {
  range: { start: string; end: string; days: number };
  audience: MetricRow[];
  audienceNetChange: MetricRow[];
  engagementTotal: MetricRow[];
  shareOfEngagement: MetricRow[];
  posts: MetricRow[];
  views: MetricRow[];
  engagementSeries: TimeSeriesResult;
  postSeries: TimeSeriesResult;
  viewSeries: TimeSeriesResult;
  /** Daily Wikipedia article views per candidate: lookup attention, not search volume. */
  attentionSeries: TimeSeriesResult;
  topPosts: PostDto[];
  /**
   * What the race talks about, from the AI tagging pipeline.
   *
   * Counts are posts the model has read and tagged; a post may carry several
   * tags. Posts the pipeline has not read yet are absent, not zero — the
   * `taggedPosts`/`totalPosts` pair states the coverage so the UI can say so.
   */
  topics: RaceTopicFacts;
}

export interface RaceTopicRef {
  id: string;
  name: string;
  color: string | null;
}

export interface RaceTopicFacts {
  /** Top tags in the window across all candidates, by tagged posts. */
  tags: (RaceTopicRef & { posts: number })[];
  /** Per-day tagged-post counts, one key per tag id in `tags`. */
  series: Array<Record<string, number | string>>;
  /** Each candidate's most-posted topics, with share of their tagged posts. */
  candidates: Array<{
    companyId: string;
    taggedPosts: number;
    topics: (RaceTopicRef & { posts: number; share: number })[];
  }>;
  /** Coverage honesty: how much of the window the pipeline has read. */
  taggedPosts: number;
  totalPosts: number;
  /** How a topic moved through the field: who posted first, who followed. */
  diffusion: TopicDiffusion[];
  /**
   * Tags held back for carrying no information in this context, with the share
   * of posts that carry them.
   *
   * Politics sits on 86 percent of posts in the 2028 field, against 21 percent
   * for the next tag down. It is true of nearly every post a candidate makes,
   * which is precisely why it distinguishes nothing, and while it was on the
   * chart it was the chart. Suppressed rather than deleted, because the same tag
   * is genuinely informative on a Somerville zoning post, and reported rather
   * than dropped quietly, because a reader who knows the taxonomy will notice it
   * missing and should not have to wonder why.
   */
  ubiquitous: (RaceTopicRef & { posts: number; share: number })[];
}

/**
 * One topic's surge and what the rest of the field did around it.
 *
 * Deliberately descriptive, never causal. "Posted first" is a timestamp, not a
 * claim that one candidate set the agenda, and "increased after" is a count
 * comparison, not evidence anyone was reacting. Whether a follow-on post
 * agrees or pushes back is NOT measured here — that needs stance detection,
 * which the pipeline does not do, so the product does not imply it.
 */
export interface TopicDiffusion {
  tag: RaceTopicRef;
  /** Highest-volume day for this topic in the window. */
  surgeDay: string;
  surgePosts: number;
  /** Earliest poster on the surge day, by post timestamp. */
  firstCompanyId: string | null;
  /** Every candidate's posting on this topic either side of the surge. */
  participants: Array<{
    companyId: string;
    before: number;
    after: number;
    /** Posted on this topic after the surge having posted less before it. */
    increased: boolean;
  }>;
}
