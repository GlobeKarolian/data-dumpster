/**
 * GET /api/instagram-plays/probe?url=<reel URL>
 *
 * Diagnostic for the reel-plays job: buys the Reels dataset for up to three
 * reel URLs and returns the fields that matter (URLs, ids, every play/view
 * field). Named users only; each URL is one paid record.
 */
import type { NextRequest } from 'next/server';
import { apiHandler, HttpError, requireOrg } from '@/lib/session';
import { canTriggerManualRefresh } from '@/lib/manual-refresh-policy';
import { DATASETS, scrapeSync } from '@/lib/vendors/brightdata';
import { installSpendMeter } from '@/lib/vendors/meter';
import { reelShortcode } from '@/lib/adapters/instagram-reel-plays';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

installSpendMeter();

export const GET = apiHandler(async (req: NextRequest) => {
  const session = await requireOrg();
  if (!canTriggerManualRefresh(session.email)) throw new HttpError(404, 'Not found.', 'not_found');
  const apiKey = process.env.BRIGHTDATA_API_KEY?.trim();
  if (!apiKey) throw new HttpError(503, 'BRIGHTDATA_API_KEY is not configured.');
  const urls = req.nextUrl.searchParams.getAll('url').filter((u) => reelShortcode(u)).slice(0, 3);
  if (urls.length === 0) throw new HttpError(400, 'Give one to three Instagram reel URLs.');
  const rows = await scrapeSync<Record<string, unknown>>(
    DATASETS.instagramReel,
    urls.map((url) => ({ url })),
    { apiKey, platform: 'instagram', timeoutMs: 200_000, limitTotal: urls.length },
  );
  const interesting = /view|play|count|url|input|post_id|shortcode|error|content_id|length|likes|comments/i;
  return Response.json({
    requested: urls,
    rows: rows.map((row) => ({
      keys: Object.keys(row).sort(),
      fields: Object.fromEntries(Object.entries(row).filter(([k]) => interesting.test(k)).map(([k, v]) => [k, typeof v === 'string' ? v.slice(0, 200) : v])),
    })),
  }, { headers: { 'cache-control': 'no-store' } });
});
