/**
 * POST /api/reports/search-screenshot — read a Looker "Top Queries" capture.
 *
 * This exists because the browser-side OCR it replaces could not survive real
 * Looker output and deleted rows without saying so. See
 * lib/reports/search-screenshot-vision.ts for the failure modes.
 *
 * The screenshot leaves the browser here, which the previous implementation
 * never did, so two things follow. The import panel says so in as many words
 * before a user drops a file, and nothing is persisted: the image is held in
 * memory for one model call and is never written to the database, to blob
 * storage, or to a log. What comes back is candidate rows for the review grid,
 * which the editor still has to accept before anything is saved.
 */
import { z } from 'zod';
import type { NextRequest } from 'next/server';
import { apiHandler, requireOrg, HttpError } from '@/lib/session';
import { checkRateLimit, LIMITS } from '../../_lib/rate-limit';
import { readJson } from '../../_lib/query';
import { ModelError } from '@/lib/ai/types';
import { readSearchScreenshots } from '@/lib/reports/search-screenshot-vision';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
/** A 40-row table on a slow provider; still bounded. */
export const maxDuration = 120;

const ACCEPTED = new Set(['image/png', 'image/jpeg', 'image/webp']);
/** Matches the client's 12 MB per-file ceiling, with base64's ~4/3 overhead. */
const MAX_BASE64_CHARS = 17_000_000;

const schema = z.object({
  images: z.array(z.object({
    mediaType: z.string().refine((v) => ACCEPTED.has(v), 'Screenshots must be PNG, JPEG or WebP.'),
    base64: z.string().min(1).max(MAX_BASE64_CHARS, 'That screenshot is too large to send.'),
  })).min(1, 'Attach at least one screenshot.').max(4, 'Send no more than four screenshots at once.'),
});

export const POST = apiHandler(async (req: NextRequest) => {
  const session = await requireOrg();
  const { orgId } = session;
  const gate = checkRateLimit(orgId, LIMITS.ai);
  if (!gate.ok) throw new HttpError(429, gate.message, 'rate_limited');

  const body = await readJson(req, schema);

  try {
    const result = await readSearchScreenshots({
      orgId,
      images: body.images,
      signal: req.signal,
    });
    return Response.json({
      /*
       * Shaped for the existing review grid. `confidence` is null rather than
       * a number: a vision model returns no per-row score, and inventing one
       * would put a confident-looking 100 next to a row nobody checked.
       */
      rows: result.rows.map((cells) => ({ cells, confidence: null, source: 'model' })),
      // Surfaced, never swallowed: a short table must not look complete.
      rejected: result.rejected.map((r) => r.reason),
      model: result.model,
      costUsd: result.costUsd,
    });
  } catch (cause) {
    if (cause instanceof ModelError) {
      // A missing or refused key is the org's configuration, not a bug here.
      throw new HttpError(502, cause.message, 'model_error');
    }
    throw cause;
  }
});
