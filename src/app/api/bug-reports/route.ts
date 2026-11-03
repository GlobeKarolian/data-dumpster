/**
 * /api/bug-reports
 *
 * POST: anyone signed in files a report from the "Report a bug" dialog. The
 * report is saved first and answered immediately; diagnostics, model triage
 * and the Slack post run after the response so the reporter never waits on
 * them. A crash there leaves triaged_at empty and /api/cron/bugs retries it.
 *
 * GET: admins list reports, newest first, optionally by status. This is also
 * the feed an engineering agent reads to pick up work.
 */
import { after, type NextRequest } from 'next/server';
import { z } from 'zod';
import { apiHandler, requireOrg, requireRole } from '@/lib/session';
import { readJson } from '../_lib/query';
import { BUG_STATUSES, bugRef, type BugStatus } from '@/lib/bugs/parse';
import { createBugReport, listBugReports } from '@/lib/bugs/store';
import { triageBugReport } from '@/lib/bugs/triage';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 120;

const createSchema = z.object({
  description: z.string().trim().min(3, 'Say what went wrong.').max(5000),
  expected: z.string().trim().max(2000).optional().nullable(),
  pageUrl: z.string().trim().max(2000).optional().nullable(),
  landscapeId: z.uuid().optional().nullable(),
  context: z.object({
    route: z.string().max(500).optional(),
    userAgent: z.string().max(500).optional(),
    viewport: z.object({ width: z.number().int().min(0).max(20000), height: z.number().int().min(0).max(20000) }).optional(),
    filters: z.record(z.string(), z.string().max(500)).optional(),
    consoleErrors: z.array(z.string().max(1000)).max(20).optional(),
    buildId: z.string().max(200).optional().nullable(),
  }).default({}),
});

export const POST = apiHandler(async (req: NextRequest) => {
  const session = await requireOrg();
  const body = await readJson(req, createSchema);
  const created = await createBugReport({
    orgId: session.orgId,
    userId: session.userId,
    email: session.email,
    description: body.description,
    expected: body.expected?.trim() || null,
    pageUrl: body.pageUrl ?? null,
    landscapeId: body.landscapeId ?? null,
    context: body.context,
  });

  after(async () => {
    try {
      await triageBugReport(session.orgId, created.id);
    } catch (error) {
      console.error('[pressbox:bugs] triage failed', { id: created.id, error });
    }
  });

  return Response.json({ id: created.id, number: created.number, ref: bugRef(created.number) }, { status: 201 });
});

export const GET = apiHandler(async (req: NextRequest) => {
  const session = await requireRole('admin');
  const sp = req.nextUrl.searchParams;
  const statuses = (sp.get('status') ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter((s): s is BugStatus => (BUG_STATUSES as readonly string[]).includes(s));
  const limit = Number(sp.get('limit') ?? '100');
  const items = await listBugReports(session.orgId, {
    statuses,
    limit: Number.isFinite(limit) ? limit : 100,
  });
  return Response.json({ items });
});
