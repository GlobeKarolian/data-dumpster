/**
 * GET /api/reports/[id]/export?format=csv|pptx
 *
 * Downloads the reviewed report as either a sectioned data file or a finished
 * executive deck. Both renderers consume the same stored ReportDocument as the
 * report builder, so the download cannot drift from the on-screen fact sheet.
 */
import { z } from 'zod';
import type { NextRequest } from 'next/server';
import { apiHandler, requireOrg, HttpError } from '@/lib/session';
import {
  renderReportCsv,
  renderReportPptx,
  reportExportFilename,
} from '@/lib/reports/export';
import {
  narrativeVerificationMessage,
  verifyReportNarrative,
} from '@/lib/reports/narrative-verification';
import {
  loadReport,
  orgName,
  reportIdSchema,
  toReportDocument,
} from '../../_lib';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 120;

const exportFormatSchema = z.enum(['csv', 'pptx']);

export const GET = apiHandler<{ id: string }>(async (req: NextRequest, ctx) => {
  const session = await requireOrg();
  const { orgId } = session;
  const id = reportIdSchema.parse((await ctx.params).id);
  const format = exportFormatSchema.parse(req.nextUrl.searchParams.get('format') ?? 'csv');
  const row = await loadReport(id, session);
  const doc = toReportDocument(row, await orgName(orgId));
  const verification = verifyReportNarrative(doc);
  if (!verification.ok) {
    throw new HttpError(
      422,
      narrativeVerificationMessage(verification),
      'unverified_narrative',
    );
  }
  const filename = reportExportFilename(doc, format);

  let body: Uint8Array;
  let contentType: string;
  if (format === 'pptx') {
    const deck = await renderReportPptx(doc);
    body = new Uint8Array(deck);
    contentType = 'application/vnd.openxmlformats-officedocument.presentationml.presentation';
  } else {
    body = new TextEncoder().encode(renderReportCsv(doc));
    contentType = 'text/csv; charset=utf-8';
  }

  // Copy into an owned ArrayBuffer. Node Buffers expose ArrayBufferLike, while
  // the web Response constructor correctly insists on a plain ArrayBuffer.
  const responseBody = new ArrayBuffer(body.byteLength);
  new Uint8Array(responseBody).set(body);

  return new Response(responseBody, {
    headers: {
      'content-type': contentType,
      'content-disposition': 'attachment; filename="' + filename + '"',
      'content-length': String(body.byteLength),
      'cache-control': 'private, no-store',
      'x-content-type-options': 'nosniff',
    },
  });
});
