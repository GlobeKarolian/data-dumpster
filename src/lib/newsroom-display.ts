import type { MetricRow } from '@/lib/types';

export const NEWSROOM_ROTATION_MS = 20_000;
export const NEWSROOM_REFRESH_MS = 5 * 60_000;
export const NEWSROOM_FRESH_PROFILE_HOURS = 14;

export type NewsroomFreshness = {
  label: string;
  tone: 'fresh' | 'aging' | 'stale' | 'unknown';
};

/**
 * A wall display always keeps the focus company visible. If it falls outside
 * the first page, the last ordinary competitor makes room for it rather than
 * forcing the newsroom to wonder where its own brand went.
 */
export function newsroomLeaderboardRows(
  rows: MetricRow[],
  focusCompanyId: string | null,
  limit = 8,
): MetricRow[] {
  const measured = rows
    .filter((row) => row.available && Number.isFinite(row.value))
    .sort((a, b) => a.rank - b.rank || b.value - a.value);
  if (measured.length <= limit) return measured;

  const visible = measured.slice(0, limit);
  const focus = focusCompanyId
    ? measured.find((row) => row.company.id === focusCompanyId) ?? null
    : null;
  if (!focus || visible.some((row) => row.company.id === focus.company.id)) return visible;

  return [...visible.slice(0, Math.max(0, limit - 1)), focus]
    .sort((a, b) => a.rank - b.rank || b.value - a.value);
}

export function newsroomFreshness(
  lastIngestedAt: string | null,
  nowMs: number,
): NewsroomFreshness {
  if (!lastIngestedAt) return { label: 'No completed collection', tone: 'unknown' };
  const timestamp = Date.parse(lastIngestedAt);
  if (!Number.isFinite(timestamp)) return { label: 'Collection time unavailable', tone: 'unknown' };

  const ageMs = Math.max(0, nowMs - timestamp);
  const minutes = Math.floor(ageMs / 60_000);
  const hours = Math.floor(ageMs / 3_600_000);
  const days = Math.floor(ageMs / 86_400_000);
  const label = minutes < 1
    ? 'Updated just now'
    : minutes < 60
      ? `Updated ${minutes}m ago`
      : hours < 24
        ? `Updated ${hours}h ago`
        : `Updated ${days}d ago`;

  if (hours < NEWSROOM_FRESH_PROFILE_HOURS) return { label, tone: 'fresh' };
  if (hours < 26) return { label, tone: 'aging' };
  return { label, tone: 'stale' };
}
