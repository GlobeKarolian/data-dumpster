/**
 * Reel plays for Instagram posts, from Bright Data's Reels dataset.
 *
 * The Instagram posts dataset returns video_view_count and video_play_count
 * as null (or 0) for reels, so every reel was stored with 0 views. The Reels
 * dataset carries `views` / `video_play_count`. Rows are matched to our posts
 * by shortcode, which is the same whether the URL uses /p/, /reel/ or /reels/.
 */

export function reelShortcode(url: string | null | undefined): string | null {
  const match = (url ?? '').match(/instagram\.com\/(?:[^/]+\/)?(?:p|reel|reels|tv)\/([A-Za-z0-9_-]+)/);
  return match ? match[1] : null;
}

function count(value: unknown): number {
  if (typeof value === 'number' && Number.isFinite(value)) return Math.max(0, Math.trunc(value));
  if (typeof value === 'string') {
    const n = Number(value.replace(/[, ]/g, ''));
    if (Number.isFinite(n)) return Math.max(0, Math.trunc(n));
  }
  return 0;
}

export function reelPlays(row: Record<string, unknown>): number {
  return Math.max(count(row.video_play_count), count(row.views), count(row.video_view_count), count(row.play_count));
}

/** shortcode -> plays, from Reels dataset rows (error rows and zero plays skipped). */
export function playsByShortcode(rows: Array<Record<string, unknown>>): Map<string, number> {
  const out = new Map<string, number>();
  for (const row of rows) {
    if (row.error || row.error_code) continue;
    const code = reelShortcode(typeof row.url === 'string' ? row.url : typeof row.input === 'object' && row.input && 'url' in row.input ? String((row.input as { url: unknown }).url) : null);
    const plays = reelPlays(row);
    if (code && plays > 0) out.set(code, Math.max(plays, out.get(code) ?? 0));
  }
  return out;
}
