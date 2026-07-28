/**
 * POST /api/settings/models/[id]/test -- one cheap round trip to the endpoint.
 *
 * This drives the green/red dot in Settings, which means it must never answer
 * with a 500. A failing model connection is not a failing request: it is the
 * exact answer the user asked for, and it deserves a 200 carrying a sentence
 * they can act on. The only non-200 outcomes here are authentication, role, a
 * malformed id, and a connection that does not belong to the caller's org.
 *
 * The result is written back to the row either way, including when resolution
 * fails before a request is ever sent -- a key that cannot be decrypted is a
 * red dot with a reason, not a dot that stays grey and lies by omission.
 */
import { z } from 'zod';
import { and, eq } from 'drizzle-orm';
import { apiHandler, requireRole, AuthError } from '@/lib/session';
import { db } from '@/db';
import { modelConnections } from '@/db/schema';
import { checkConnection, resolveConnection } from '@/lib/ai/client';
import type { ResolvedModelConnection } from '@/lib/ai/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
/** A cold self-hosted endpoint can take a while to answer its first token. */
export const maxDuration = 60;

const idSchema = z.uuid('That is not a model connection id.');

/** Keep the row's health honest when the failure happened before the request. */
async function recordFailure(id: string, message: string): Promise<void> {
  try {
    await db
      .update(modelConnections)
      .set({ lastCheckedAt: new Date(), lastCheckOk: false, lastCheckError: message.slice(0, 1000) })
      .where(eq(modelConnections.id, id));
  } catch (cause) {
    console.error('[pressbox:api] failed to persist model check failure', cause);
  }
}

export const POST = apiHandler<{ id: string }>(async (_req, ctx) => {
  const { orgId } = await requireRole('admin');
  const id = idSchema.parse((await ctx.params).id);

  const [row] = await db
    .select({ id: modelConnections.id })
    .from(modelConnections)
    .where(and(eq(modelConnections.id, id), eq(modelConnections.orgId, orgId)))
    .limit(1);
  if (!row) throw new AuthError('not_found', 'That model connection does not exist.');

  const started = Date.now();
  let connection: ResolvedModelConnection;
  try {
    // Decryption and provider lookup can both fail; neither is a server error.
    connection = await resolveConnection(orgId, id);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await recordFailure(id, message);
    return Response.json(
      { ok: false, message, error: message, latencyMs: Date.now() - started, model: null },
      { headers: { 'cache-control': 'private, no-store' } },
    );
  }

  // checkConnection swallows provider errors itself and persists the verdict.
  const result = await checkConnection(connection);
  const message = result.ok
    ? 'Reachable in ' + result.latencyMs + 'ms' + (result.model ? ' as ' + result.model : '') + '.'
    : result.error ?? 'The endpoint did not answer.';

  return Response.json(
    {
      ok: result.ok,
      message,
      error: result.ok ? null : message,
      latencyMs: result.latencyMs,
      model: result.model,
    },
    { headers: { 'cache-control': 'private, no-store' } },
  );
});
