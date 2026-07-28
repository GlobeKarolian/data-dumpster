/**
 * The one place the rest of Pressbox talks to a model.
 *
 * Everything AI-shaped in the app funnels through complete(), which means three
 * guarantees hold everywhere for free:
 *   1. Keys are decrypted at the last possible moment and never returned to a
 *      caller, logged, or embedded in an error message.
 *   2. Every call is metered. An org can answer "what did this cost us" from
 *      its own database, in its own currency, without trusting our invoice.
 *   3. Transient failures are retried; permanent ones fail fast with a message
 *      that names the fix. A 401 should never be retried three times.
 */
import { and, desc, eq } from 'drizzle-orm';
import { db } from '@/db';
import { aiUsage, modelConnections } from '@/db/schema';
import { decrypt } from '@/lib/crypto';
import { getProvider } from './registry';
import {
  ModelError,
  type CompletionRequest,
  type CompletionResult,
  type ModelProviderId,
  type ResolvedModelConnection,
} from './types';

const PROVIDER_IDS: ModelProviderId[] = [
  'anthropic', 'openai', 'google', 'azure_openai', 'bedrock', 'openai_compatible', 'ollama',
];

const MAX_ATTEMPTS = 3;
const BASE_BACKOFF_MS = 600;

export interface CompleteOptions {
  /** Use a specific connection instead of the org default. */
  connectionId?: string;
  /** Recorded on the usage row so spend can be attributed per surface. */
  feature?: string;
  maxAttempts?: number;
  /** Pre-resolved connection, so callers doing several calls resolve once. */
  connection?: ResolvedModelConnection;
}

export interface CompleteResponse extends CompletionResult {
  connection: ResolvedModelConnection;
  costUsd: number;
  attempts: number;
}

/* ------------------------------------------------------------ resolution */

function envProviderId(): ModelProviderId | null {
  const raw = process.env.DEFAULT_MODEL_PROVIDER?.trim();
  if (raw) {
    const match = PROVIDER_IDS.find((p) => p === raw);
    if (!match) {
      throw new ModelError(
        `DEFAULT_MODEL_PROVIDER is set to "${raw}", which is not a provider Pressbox knows. `
        + `Valid values: ${PROVIDER_IDS.join(', ')}.`,
        { provider: 'anthropic', retryable: false },
      );
    }
    return match;
  }
  // No explicit choice: infer from whichever key the operator actually supplied.
  if (process.env.ANTHROPIC_API_KEY) return 'anthropic';
  if (process.env.OPENAI_API_KEY) return 'openai';
  if (process.env.GOOGLE_API_KEY) return 'google';
  if (process.env.OLLAMA_BASE_URL) return 'ollama';
  return null;
}

function envApiKey(provider: ModelProviderId): string | null {
  switch (provider) {
    case 'anthropic': return process.env.ANTHROPIC_API_KEY ?? null;
    case 'openai': return process.env.OPENAI_API_KEY ?? null;
    case 'google': return process.env.GOOGLE_API_KEY ?? null;
    case 'azure_openai': return process.env.AZURE_OPENAI_API_KEY ?? null;
    case 'openai_compatible': return process.env.OPENAI_COMPATIBLE_API_KEY ?? process.env.OPENAI_API_KEY ?? null;
    default: return null;
  }
}

function envBaseUrl(provider: ModelProviderId): string | null {
  switch (provider) {
    case 'ollama': return process.env.OLLAMA_BASE_URL ?? null;
    case 'openai_compatible': return process.env.OPENAI_COMPATIBLE_BASE_URL ?? null;
    case 'azure_openai': return process.env.AZURE_OPENAI_ENDPOINT ?? null;
    default: return process.env.MODEL_BASE_URL ?? null;
  }
}

const NOTHING_CONFIGURED =
  'No AI model is configured for this workspace. Add a connection in Settings > AI Model '
  + '(Anthropic, OpenAI, Google, Azure OpenAI, any OpenAI-compatible endpoint, or a local Ollama '
  + 'server), or set DEFAULT_MODEL_PROVIDER and the matching API key in the environment. '
  + 'Pressbox ships no hosted model on purpose: the inference is yours.';

/**
 * Find the connection a request should run on: the named one, else the org
 * default, else the newest enabled one, else the environment. Decryption
 * happens here and nowhere else.
 */
export async function resolveConnection(
  orgId: string,
  connectionId?: string,
): Promise<ResolvedModelConnection> {
  const rows = connectionId
    ? await db.select().from(modelConnections)
      .where(and(eq(modelConnections.orgId, orgId), eq(modelConnections.id, connectionId)))
      .limit(1)
    : await db.select().from(modelConnections)
      .where(and(eq(modelConnections.orgId, orgId), eq(modelConnections.enabled, true)))
      .orderBy(desc(modelConnections.isDefault), desc(modelConnections.createdAt))
      .limit(1);

  const row = rows[0];
  if (row) {
    if (connectionId && !row.enabled) {
      throw new ModelError(
        `Model connection "${row.label}" is disabled. Re-enable it in Settings > AI Model or pick another.`,
        { provider: row.provider, retryable: false },
      );
    }
    let apiKey: string | null = null;
    if (row.encryptedApiKey) {
      try {
        apiKey = decrypt(row.encryptedApiKey);
      } catch (cause) {
        throw new ModelError(
          `The stored API key for "${row.label}" could not be decrypted. This usually means ENCRYPTION_KEY `
          + `changed since the key was saved. Re-enter the key in Settings > AI Model. (${String(cause)})`,
          { provider: row.provider, retryable: false },
        );
      }
    }
    return {
      id: row.id,
      orgId: row.orgId,
      label: row.label,
      provider: row.provider,
      model: row.model,
      baseUrl: row.baseUrl,
      apiKey,
      maxOutputTokens: row.maxOutputTokens,
      inputCostPerMtok: row.inputCostPerMtok,
      outputCostPerMtok: row.outputCostPerMtok,
    };
  }

  if (connectionId) {
    throw new ModelError(
      `Model connection ${connectionId} does not exist in this workspace.`,
      { provider: 'anthropic', retryable: false },
    );
  }

  const provider = envProviderId();
  if (!provider) throw new ModelError(NOTHING_CONFIGURED, { provider: 'anthropic', retryable: false });

  const definition = getProvider(provider);
  const apiKey = envApiKey(provider);
  if (definition.needsApiKey && !apiKey) {
    throw new ModelError(
      `DEFAULT_MODEL_PROVIDER is "${provider}" but no API key is set for it in the environment. `
      + `Set the key, or configure a connection in Settings > AI Model.`,
      { provider, retryable: false },
    );
  }
  const baseUrl = envBaseUrl(provider);
  if (definition.baseUrl === 'required' && !baseUrl) {
    throw new ModelError(
      `DEFAULT_MODEL_PROVIDER is "${provider}", which needs a base URL. Set it in the environment `
      + `or configure the connection in Settings > AI Model.`,
      { provider, retryable: false },
    );
  }
  const model = process.env.DEFAULT_MODEL?.trim()
    || definition.suggestedModels[1]?.id
    || definition.suggestedModels[0]?.id;
  if (!model) {
    throw new ModelError(
      `DEFAULT_MODEL is not set and provider "${provider}" has no suggested model to fall back to.`,
      { provider, retryable: false },
    );
  }
  const suggested = definition.suggestedModels.find((m) => m.id === model);

  return {
    id: 'env',
    orgId,
    label: `Environment default (${definition.displayName})`,
    provider,
    model,
    baseUrl,
    apiKey,
    maxOutputTokens: Number(process.env.DEFAULT_MODEL_MAX_TOKENS ?? 4096) || 4096,
    inputCostPerMtok: suggested?.inputCost ?? null,
    outputCostPerMtok: suggested?.outputCost ?? null,
  };
}

/* ------------------------------------------------------------------ cost */

/**
 * Cost in USD from the connection's own per-1M-token prices.
 *
 * Prices live on the connection rather than in a table we maintain, because the
 * org is the one being billed and vendor pricing changes without warning. If an
 * org has not entered prices, we report 0 and the UI says "not priced" — an
 * invented number would be worse than no number.
 */
export function estimateCost(
  conn: Pick<ResolvedModelConnection, 'inputCostPerMtok' | 'outputCostPerMtok'>,
  inputTokens: number,
  outputTokens: number,
): number {
  const inRate = conn.inputCostPerMtok ?? 0;
  const outRate = conn.outputCostPerMtok ?? 0;
  const cost = (inputTokens / 1_000_000) * inRate + (outputTokens / 1_000_000) * outRate;
  return Number.isFinite(cost) ? Math.max(0, cost) : 0;
}

/* --------------------------------------------------------------- metering */

interface UsageRecord {
  orgId: string;
  connectionId: string | null;
  feature: string;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
  latencyMs: number | null;
  ok: boolean;
  error: string | null;
}

/**
 * Metering is best-effort by design. A newsroom that just generated a brief
 * should not lose it because the usage insert hit a connection-pool limit.
 * We log and move on; the brief is the product, the ledger is the bookkeeping.
 */
async function recordUsage(record: UsageRecord): Promise<void> {
  try {
    await db.insert(aiUsage).values({
      orgId: record.orgId,
      // 'env' is not a uuid, so a synthetic connection is recorded as null.
      connectionId: record.connectionId && record.connectionId !== 'env' ? record.connectionId : null,
      feature: record.feature,
      inputTokens: record.inputTokens,
      outputTokens: record.outputTokens,
      costUsd: record.costUsd,
      latencyMs: record.latencyMs,
      ok: record.ok,
      error: record.error ? record.error.slice(0, 1000) : null,
    });
  } catch (cause) {
    console.error('[ai] failed to record usage', cause);
  }
}

/* ----------------------------------------------------------------- retry */

function isRetryable(err: unknown): boolean {
  return err instanceof ModelError && err.opts.retryable === true;
}

/** Exponential backoff with full jitter, so N parallel briefs do not resynchronise. */
function backoffMs(attempt: number): number {
  const ceiling = Math.min(BASE_BACKOFF_MS * 2 ** (attempt - 1), 8000);
  return Math.round(ceiling / 2 + Math.random() * (ceiling / 2));
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener('abort', () => {
      clearTimeout(timer);
      reject(new ModelError('Request cancelled while backing off.', { provider: 'anthropic', retryable: false }));
    }, { once: true });
  });
}

/* -------------------------------------------------------------- complete */

/**
 * Run a completion for an org, with retries and metering.
 *
 * Latency reported to the caller is wall-clock across all attempts, because
 * that is what the user waited; the per-attempt figure would flatter us.
 */
export async function complete(
  orgId: string,
  req: CompletionRequest,
  opts: CompleteOptions = {},
): Promise<CompleteResponse> {
  const conn = opts.connection ?? await resolveConnection(orgId, opts.connectionId);
  const provider = getProvider(conn.provider);
  const feature = opts.feature ?? 'unknown';
  const maxAttempts = Math.max(1, opts.maxAttempts ?? MAX_ATTEMPTS);
  const startedAt = Date.now();

  let lastError: unknown;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      const result = await provider.complete(conn, req);
      const costUsd = estimateCost(conn, result.inputTokens, result.outputTokens);
      const latencyMs = Date.now() - startedAt;
      await recordUsage({
        orgId,
        connectionId: conn.id,
        feature,
        inputTokens: result.inputTokens,
        outputTokens: result.outputTokens,
        costUsd,
        latencyMs,
        ok: true,
        error: null,
      });
      return { ...result, latencyMs, connection: conn, costUsd, attempts: attempt };
    } catch (err) {
      lastError = err;
      if (attempt < maxAttempts && isRetryable(err)) {
        await sleep(backoffMs(attempt), req.signal);
        continue;
      }
      break;
    }
  }

  const message = lastError instanceof Error ? lastError.message : String(lastError);
  await recordUsage({
    orgId,
    connectionId: conn.id,
    feature,
    inputTokens: 0,
    outputTokens: 0,
    costUsd: 0,
    latencyMs: Date.now() - startedAt,
    ok: false,
    error: message,
  });
  throw lastError instanceof ModelError
    ? lastError
    : new ModelError(message, { provider: conn.provider, retryable: false });
}

/* ------------------------------------------------------------ health check */

export interface ConnectionCheck {
  ok: boolean;
  error: string | null;
  latencyMs: number;
  model: string | null;
}

/**
 * The cheapest possible round trip, used by the green/red dot in Settings.
 *
 * One token of output and a trivial prompt: enough to prove the endpoint, the
 * key, and the model name are all real, cheap enough to run on every page load
 * of the settings screen. The result is written back to the connection row so
 * the dot reflects a measurement with a timestamp, not an optimistic guess.
 */
export async function checkConnection(conn: ResolvedModelConnection): Promise<ConnectionCheck> {
  const provider = getProvider(conn.provider);
  const started = Date.now();
  let ok = false;
  let error: string | null = null;
  let model: string | null = null;

  try {
    const result = await provider.complete(conn, {
      messages: [{ role: 'user', content: 'Reply with the single word: ok' }],
      maxTokens: 8,
      temperature: 0,
    });
    ok = true;
    model = result.model;
  } catch (err) {
    ok = false;
    error = err instanceof Error ? err.message : String(err);
  }

  const latencyMs = Date.now() - started;
  if (conn.id && conn.id !== 'env') {
    try {
      await db.update(modelConnections)
        .set({ lastCheckedAt: new Date(), lastCheckOk: ok, lastCheckError: error ? error.slice(0, 1000) : null })
        .where(eq(modelConnections.id, conn.id));
    } catch (cause) {
      console.error('[ai] failed to persist connection health check', cause);
    }
  }
  return { ok, error, latencyMs, model };
}
