/**
 * /api/settings/models -- the org's bring-your-own-model connections.
 *
 * GET  list them, safely.
 * POST create one (admin only).
 *
 * The rule that governs both: a key that has been written is never readable
 * again, by anyone, including the person who typed it. The stored value is
 * ciphertext, so masking it directly would show a meaningless slice of base64;
 * we decrypt server-side and mask the plaintext instead, which tells a user
 * which key is configured without telling them the key. hasKey is sent
 * alongside because a mask that fails to decrypt still means a key exists, and
 * the UI needs to distinguish "no key" from "key we cannot read".
 */
import { z } from 'zod';
import { and, asc, desc, eq } from 'drizzle-orm';
import type { NextRequest } from 'next/server';
import { apiHandler, requireOrg, requireRole, HttpError } from '@/lib/session';
import { db } from '@/db';
import { modelConnections, modelProviderEnum } from '@/db/schema';
import { encrypt, decrypt, maskSecret } from '@/lib/crypto';
import { checkKeyShape } from '@/lib/ai/key-shape';
import { getProvider, isProviderImplemented } from '@/lib/ai/registry';
import { readJson } from '../../_lib/query';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type ConnectionRow = typeof modelConnections.$inferSelect;

/**
 * The only shape a connection is ever allowed to leave the server in.
 *
 * Fields are listed one by one rather than spread, so a column added to the
 * table later cannot become part of an API response by accident -- which is
 * exactly how encrypted_api_key would otherwise escape one day.
 */
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
    /** components/settings/model-connections.tsx reads this name. */
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

const createConnectionSchema = z.object({
  label: z.string().trim().min(1).max(120),
  provider: z.enum(modelProviderEnum.enumValues),
  model: z.string().trim().min(1).max(200),
  baseUrl: z.url('The base URL must be absolute, for example http://localhost:11434.').nullish(),
  apiKey: z.string().trim().min(1).max(4000).nullish(),
  inputCostPerMtok: z.number().nonnegative().max(100_000).nullish(),
  outputCostPerMtok: z.number().nonnegative().max(100_000).nullish(),
  maxOutputTokens: z.number().int().min(64).max(200_000).optional(),
  isDefault: z.boolean().optional(),
});

export const GET = apiHandler(async () => {
  const { orgId } = await requireOrg();

  const rows = await db
    .select()
    .from(modelConnections)
    .where(eq(modelConnections.orgId, orgId))
    .orderBy(desc(modelConnections.isDefault), asc(modelConnections.createdAt));

  return Response.json(
    { items: rows.map(present) },
    { headers: { 'cache-control': 'private, no-store' } },
  );
});

export const POST = apiHandler(async (req: NextRequest) => {
  const { orgId } = await requireRole('admin');
  const body = await readJson(req, createConnectionSchema);

  /**
   * Validate against what the provider itself declares it needs. Doing this
   * here rather than at call time turns a broken brief three days from now into
   * a rejected form field today.
   */
  const definition = getProvider(body.provider);
  if (!isProviderImplemented(body.provider)) {
    throw new HttpError(
      422,
      definition.displayName + ' cannot run completions yet, so a connection to it would never work.',
      'provider_unavailable',
    );
  }

  // A provider that ignores baseUrl gets null, not the user's stray paste.
  const baseUrl = definition.baseUrl === 'none' ? null : body.baseUrl ?? null;
  if (definition.baseUrl === 'required' && !baseUrl) {
    throw new HttpError(422, definition.displayName + ' needs a base URL.', 'base_url_required');
  }
  if (definition.needsApiKey && !body.apiKey) {
    throw new HttpError(422, definition.displayName + ' needs an API key.', 'api_key_required');
  }

  // A key pasted against the wrong provider stores and encrypts perfectly, then
  // fails at generation time with "invalid x-api-key", which reads as a bad key
  // rather than a misfiled one. Refuse it here with the actual explanation.
  if (body.apiKey) {
    const shapeProblem = checkKeyShape(body.provider, body.apiKey);
    if (shapeProblem) throw new HttpError(422, shapeProblem, 'key_shape_mismatch');
  }

  /**
   * Demote the incumbent before promoting the newcomer. The other order would
   * leave a window in which two connections claim to be the default, and
   * resolveConnection picks by isDefault DESC -- it would silently choose one.
   */
  if (body.isDefault) {
    await db
      .update(modelConnections)
      .set({ isDefault: false })
      .where(and(eq(modelConnections.orgId, orgId), eq(modelConnections.isDefault, true)));
  }

  const [created] = await db
    .insert(modelConnections)
    .values({
      orgId,
      label: body.label,
      provider: body.provider,
      model: body.model,
      baseUrl,
      encryptedApiKey: body.apiKey ? encrypt(body.apiKey) : null,
      inputCostPerMtok: body.inputCostPerMtok ?? null,
      outputCostPerMtok: body.outputCostPerMtok ?? null,
      maxOutputTokens: body.maxOutputTokens ?? 4096,
      isDefault: body.isDefault ?? false,
    })
    .returning();

  return Response.json(present(created), { status: 201 });
});
