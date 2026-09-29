/**
 * What the weekly report counts as a video view: a play of a video post, on a
 * platform whose view number is a play count.
 *
 * The report once summed every platform's `views` field, but those mean
 * different things: TikTok, YouTube, Facebook and Instagram report plays; X
 * reports impressions (every time any post, video or not, appears on screen);
 * Threads reports post views. A single widely quoted X link post (31M
 * impressions, Sept 2026) swamped the section, so only plays count here.
 */
import type { ReportPlatform } from './types';

export const VIDEO_POST_TYPES = ['video', 'reel', 'short', 'live'] as const;
export const VIDEO_PLAY_PLATFORMS = ['tiktok', 'youtube', 'facebook', 'instagram'] as const;

export function countsAsVideoView(platform: string, type: string): boolean {
  return (VIDEO_PLAY_PLATFORMS as readonly string[]).includes(platform)
    && (VIDEO_POST_TYPES as readonly string[]).includes(type);
}

export type VideoViewRow = {
  company_id: string;
  platform: string;
  views: number | string | null;
};

export interface CompanyVideoViews {
  total: number;
  byPlatform: Partial<Record<ReportPlatform, number>>;
}

/** Per-company totals; platforms outside the play-count set are ignored. */
export function videoViewsByCompany(rows: VideoViewRow[]): Map<string, CompanyVideoViews> {
  const out = new Map<string, CompanyVideoViews>();
  for (const row of rows) {
    if (!(VIDEO_PLAY_PLATFORMS as readonly string[]).includes(row.platform)) continue;
    const views = Number(row.views ?? 0);
    if (!Number.isFinite(views) || views <= 0) continue;
    const entry = out.get(row.company_id) ?? { total: 0, byPlatform: {} };
    const platform = row.platform as ReportPlatform;
    entry.byPlatform[platform] = (entry.byPlatform[platform] ?? 0) + views;
    entry.total += views;
    out.set(row.company_id, entry);
  }
  return out;
}
