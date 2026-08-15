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
  topPosts: PostDto[];
}
