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
}
