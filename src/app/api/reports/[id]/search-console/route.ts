import { and, eq } from 'drizzle-orm';
import { db } from '@/db';
import { weeklyReports } from '@/db/schema';
import { apiHandler, AuthError, HttpError, requireRole } from '@/lib/session';
import {
  pullSearchConsoleTables,
  SearchConsoleError,
} from '@/lib/reports/search-console';
import { readManual, readNarrative } from '@/lib/reports/types';
import { SEARCH_DASHBOARDS, type SearchTableId } from '@/lib/reports/search-console-sources';
import { loadReport, reportIdSchema, serializeReport } from '../../_lib';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export const POST = apiHandler<{ id: string }>(async (_req, ctx) => {
  const session = await requireRole('editor');
  const { orgId } = session;
  const id = reportIdSchema.parse((await ctx.params).id);
  const existing = await loadReport(id, session);

  let tables;
  try {
    tables = await pullSearchConsoleTables({
      start: existing.periodStart,
      end: existing.periodEnd,
    });
  } catch (error) {
    if (error instanceof SearchConsoleError) {
      throw new HttpError(
        error.code === 'not_configured' ? 503 : 502,
        error.message,
        error.code,
      );
    }
    throw error;
  }

  const manual = readManual(existing.manual);
  for (const id of Object.keys(tables) as SearchTableId[]) {
    tables[id] = {
      ...tables[id],
      sourceUrl: manual.tables[id]?.sourceUrl ?? SEARCH_DASHBOARDS[id].url,
    };
  }
  const narrative = readNarrative(existing.narrative);
  delete narrative.search;

  const [row] = await db
    .update(weeklyReports)
    .set({
      manual: { ...manual, tables: { ...manual.tables, ...tables } },
      narrative,
      updatedAt: new Date(),
    })
    .where(and(eq(weeklyReports.id, id), eq(weeklyReports.orgId, orgId)))
    .returning();

  if (!row) throw new AuthError('not_found', 'That report does not exist.');
  return Response.json(serializeReport(row), { headers: { 'cache-control': 'private, no-store' } });
});
