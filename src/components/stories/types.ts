/**
 * The wire shape of a story cluster.
 *
 * Clustering runs on the server against full post rows that carry raw payloads
 * and extracted URLs. None of that belongs in a browser bundle, and Dates do
 * not survive the server-to-client boundary intact, so the cloud renders from
 * this narrowed, serialisable view instead of the cluster itself.
 */
import type { Platform } from '@/lib/types';
import type { StoryCluster } from '@/lib/stories/cluster';

export interface StoryPostDto {
  id: string;
  companyId: string;
  companyName: string;
  platform: Platform;
  /** ISO 8601. */
  postedAt: string;
  text: string | null;
  permalink: string | null;
  engagementTotal: number;
  views: number;
}

export interface StoryCompanyDto {
  id: string;
  name: string;
  postCount: number;
  engagement: number;
}

export interface StoryDto {
  id: string;
  label: string;
  posts: StoryPostDto[];
  companies: StoryCompanyDto[];
  platforms: Platform[];
  firstPostedAt: string;
  lastPostedAt: string;
  totalEngagement: number;
  totalViews: number;
  brokeBy: { id: string; name: string } | null;
  topPostId: string;
  keywords: string[];
  /** 0 to 1. Surfaced in the UI rather than hidden. */
  cohesion: number;
}

export interface StoryCloudDto {
  clusters: StoryDto[];
  postCount: number;
  unclusteredCount: number;
}

export function toStoryDto(cluster: StoryCluster): StoryDto {
  return {
    id: cluster.id,
    label: cluster.label,
    posts: cluster.posts
      .map((p) => ({
        id: p.id,
        companyId: p.companyId,
        companyName: p.companyName,
        platform: p.platform,
        postedAt: p.postedAt.toISOString(),
        text: p.text,
        permalink: p.permalink,
        engagementTotal: p.engagementTotal,
        views: p.views,
      }))
      .sort((a, b) => a.postedAt.localeCompare(b.postedAt)),
    companies: cluster.companies,
    platforms: cluster.platforms,
    firstPostedAt: cluster.firstPostedAt.toISOString(),
    lastPostedAt: cluster.lastPostedAt.toISOString(),
    totalEngagement: cluster.totalEngagement,
    totalViews: cluster.totalViews,
    brokeBy: cluster.brokeBy,
    topPostId: cluster.topPostId,
    keywords: cluster.keywords,
    cohesion: cluster.cohesion,
  };
}
