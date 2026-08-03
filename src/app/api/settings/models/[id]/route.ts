/**
 * /api/settings/models/[id]
 *
 * PATCH  edit a connection (admin only).
 * DELETE remove one (admin only).
 *
 * Two behaviours here are load-bearing.
 *
 * The API key is write-only and sticky: it is re-encrypted only when a new,
 * non-empty one arrives. An omitted field and an empty string both mean "leave
 * the stored key alone", because the edit form has no way to show the current
 * key and would otherwise wipe it every time someone renamed a connection.
 *
 * Cross-tenant access answers 404, not 403. A 403 would confirm that a
 * connection with that id exists in some other newsroom, which is the first
 * half of an enumeration attack; every statement below carries org_id in its
 * WHERE clause so a foreign id is indistinguishable from a deleted one.
 */
import { z } from 'zod';
import { and, eq, ne } from 'drizzle-orm';
import { apiHandler, requireRole, AuthError, HttpError } from '@/lib/session';
import { db } from '@/db';
import { modelConnections } from '@/db/schema';
import { encrypt, decrypt, maskSecret } from '@/lib/crypto';
import { checkBaseUrl } from '@/lib/ai/base-url';
import { getProvider } from '@/lib/ai/registry';
import { readJson } from '../../../_lib/query';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type ConnectionRow = typeof modelConnections.$inferSelect;

/** Identical projection to the collection endpoint; see the note there. */
function present(row: ConnectionRow) {
  let keyMask: string | null = null;
  if (row.encryptedApiKey) {
    try {
      keyMask = maskSecret(decrypt(row.encryptedApiKey));
    } catch {
      keyMask = 'unreadable - check ENCRYPTION_KEY';
    }
  }
  return {
    id: row.id,
    label: row.label,
    provider: row.provider,
    providerLabel: getProvider(row.provider).displayName,
    model: row.model,
    baseUrl: row.baseUrl,
    hasKey: row.encryptedApiKey !== null,
    keyMask,
    maskedKey: keyMask,
    inputCostPerMtok: row.inputCostPerMtok,
    outputCostPerMtok: row.outputCostPerMtok,
    maxOutputTokens: row.maxOutputTokens,
    isDefault: row.isDefault,
    enabled: row.enabled,
    lastCheckedAt: row.lastCheckedAt,
    lastCheckOk: row.lastCheckOk,
    lastCheckError: row.lastCheckError,
    createdAt: row.createdAt,
  };
}

const idSchema = z.uuid('That is not a model connection id.');

const updateConnectionSchema = z.object({
  label: z.string().trim().min(1).max(120).optional(),
  model: z.string().trim().min(1).max(200).optional(),
  baseUrl: z.url('The base URL must be absolute.').nullish(),
  /** Empty string is meaningful: it means "keep the key you already have". */
  apiKey: z.string().max(4000).nullish(),
  inputCostPerMtok: z.number().nonnegative().max(100_000).nullish(),
  outputCostPerMtok: z.number().nonnegative().max(100_000).nullish(),
  maxOutputTokens: z.number().int().min(64).max(200_000).optional(),
  isDefault: z.boolean().optional(),
  enabled: z.boolean().optional(),
}).refine((b) => Object.keys(b).length > 0, 'Nothing to update.');

async function loadOwned(id: string, orgId: string): Promise<ConnectionRow> {
  const [row] = await db
    .select()
    .from(modelConnections)
    .where(and(eq(modelConnections.id, id), eq(modelConnections.orgId, orgId)))
    .limit(1);
  if (!row) throw new AuthError('not_found', 'That model connection does not exist.');
  return row;
}

export const PATCH = apiHandler<{ id: string }>(async (req, ctx) => {
  const { orgId } = await requireRole('admin');
  const id = idSchema.parse((await ctx.params).id);
  const body = await readJson(req, updateConnectionSchema);
  const existing = await loadOwned(id, orgId);

  // The provider is fixed for the life of a connection, so its requirements are
  // checked against the stored provider rather than anything the client sent.
  const definition = getProvider(existing.provider);
  const nextBaseUrl = body.baseUrl === undefined
    ? existing.baseUrl
    : definition.baseUrl === 'none' ? null : body.baseUrl ?? null;
  if (definition.baseUrl === 'required' && !nextBaseUrl) {
    throw new HttpError(422, definition.displayName + ' needs a base URL.', 'base_url_required');
  }
  /*
   * Re-checked on every PATCH, not only when the URL changes.
   *
   * apiKey is sticky here: omitting it keeps the stored key. That is what makes
   * an unchecked baseUrl a credential-exfiltration primitive, because it lets
   * someone repoint an existing connection at a host they control without
   * knowing the key they are about to be sent.
   */
  const check = checkBaseUrl(nextBaseUrl);
  if (!check.ok) throw new HttpError(422, check.reason, 'base_url_rejected');

  if (body.isDefault) {
    await db
      .update(modelConnections)
      .set({ isDefault: false })
      .where(and(
        eq(modelConnections.orgId, orgId),
        eq(modelConnections.isDefault, true),
        ne(modelConnections.id, id),
      ));
  }

  const [updated] = await db
    .update(modelConnections)
    .set({
      ...(body.label !== undefined ? { label: body.label } : {}),
      ...(body.model !== undefined ? { model: body.model } : {}),
      ...(body.baseUrl !== undefined ? { baseUrl: nextBaseUrl } : {}),
      // Only a non-empty key is a new key. Anything else leaves the column be.
      ...(body.apiKey ? { encryptedApiKey: encrypt(body.apiKey) } : {}),
      ...(body.inputCostPerMtok !== undefined ? { inputCostPerMtok: body.inputCostPerMtok ?? null } : {}),
      ...(body.outputCostPerMtok !== undefined ? { outputCostPerMtok: body.outputCostPerMtok ?? null } : {}),
      ...(body.maxOutputTokens !== undefined ? { maxOutputTokens: body.maxOutputTokens } : {}),
      ...(body.isDefault !== undefined ? { isDefault: body.isDefault } : {}),
      ...(body.enabled !== undefined ? { enabled: body.enabled } : {}),
    })
    .where(and(eq(modelConnections.id, id), eq(modelConnections.orgId, orgId)))
    .returning();

  if (!updated) throw new AuthError('not_found', 'That model connection does not exist.');
  return Response.json(present(updated), { headers: { 'cache-control': 'private, no-store' } });
});

export const DELETE = apiHandler<{ id: string }>(async (_req, ctx) => {
  const { orgId } = await requireRole('admin');
  const id = idSchema.parse((await ctx.params).id);
  const existing = await loadOwned(id, orgId);

  /**
   * Deleting the default while alternatives exist would leave the org with
   * connections but no chosen one, and every AI feature would silently start
   * running through whichever row sorted first. Deleting the last connection is
   * allowed: an org with no model at all gets an honest error at call time,
   * which is a much clearer state than an arbitrary default.
   */
  if (existing.isDefault) {
    const [other] = await db
      .select({ id: modelConnections.id })
      .from(modelConnections)
      .where(and(eq(modelConnections.orgId, orgId), ne(modelConnections.id, id)))
      .limit(1);
    if (other) {
      throw new HttpError(
        409,
        'This is the default connection. Make another connection the default before deleting it.',
        'default_connection',
      );
    }
  }

  const [deleted] = await db
    .delete(modelConnections)
    .where(and(eq(modelConnections.id, id), eq(modelConnections.orgId, orgId)))
    .returning({ id: modelConnections.id });

  if (!deleted) throw new AuthError('not_found', 'That model connection does not exist.');
  return new Response(null, { status: 204 });
});
