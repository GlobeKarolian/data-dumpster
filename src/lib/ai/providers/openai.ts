/**
 * OpenAI Chat Completions (POST /v1/chat/completions).
 *
 * The transport here is deliberately exported (`chatCompletion`) because three
 * of our seven providers speak the exact same wire format: OpenAI itself, Azure
 * OpenAI, and the long tail of OpenAI-shaped endpoints (Groq, Together,
 * Fireworks, OpenRouter, vLLM, LM Studio). One implementation, three surfaces —
 * so a bug fixed for OpenAI is fixed for a newsroom's self-hosted vLLM too.
 *
 * Two real-world quirks are handled:
 *   - Reasoning-era models (o-series, gpt-5*) reject `max_tokens` and require
 *     `max_completion_tokens`, and reject a non-default `temperature`.
 *   - `strict: true` structured outputs require every object to declare
 *     `additionalProperties: false`; we only opt in when the caller's schema
 *     actually says so, otherwise the API 400s on a schema that is perfectly
 *     valid JSON Schema.
 */
import {
  ModelError,
  type CompletionRequest,
  type CompletionResult,
  type ModelProvider,
  type ModelProviderId,
  type ResolvedModelConnection,
} from '../types';

interface ChatChoice { message?: { content?: string | null }; finish_reason?: string | null }
interface ChatBody {
  model?: string;
  choices?: ChatChoice[];
  usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number };
}

export function retryableStatus(status: number): boolean {
  return status === 408 || status === 425 || status === 429 || status >= 500;
}

export function extractErrorMessage(status: number, body: string): string {
  try {
    const parsed: unknown = JSON.parse(body);
    if (parsed && typeof parsed === 'object') {
      const err = (parsed as { error?: unknown }).error;
      if (typeof err === 'string' && err.trim()) return err;
      if (err && typeof err === 'object' && 'message' in err) {
        const m = (err as { message?: unknown }).message;
        if (typeof m === 'string' && m.trim()) return m;
      }
      const msg = (parsed as { message?: unknown }).message;
      if (typeof msg === 'string' && msg.trim()) return msg;
    }
  } catch { /* not JSON — fall back to the raw body */ }
  return body.trim().slice(0, 400) || `HTTP ${status}`;
}

/** o-series and gpt-5 family: different token knob, fixed temperature. */
function isReasoningModel(model: string): boolean {
  return /^(o\d|gpt-5)/i.test(model.replace(/^.*\//, ''));
}

/** `strict` only works if the schema closes every object. Detect, don't assume. */
function schemaIsStrictReady(schema: Record<string, unknown>): boolean {
  return JSON.stringify(schema).includes('"additionalProperties":false');
}

export interface ChatTransport {
  provider: ModelProviderId;
  /** Fully-qualified endpoint, including any query string. */
  url: string;
  headers: Record<string, string>;
  /** Body `model` field. Azure ignores it in favour of the deployment in the URL. */
  model: string;
  /** Some self-hosted servers 400 on response_format; let callers opt out. */
  supportsJsonSchema?: boolean;
  /** Prefix used in error messages the user will actually read. */
  label: string;
}

export async function chatCompletion(
  t: ChatTransport,
  conn: ResolvedModelConnection,
  req: CompletionRequest,
): Promise<CompletionResult> {
  const reasoning = isReasoningModel(t.model);

  /**
   * Reasoning models bill and consume internal reasoning tokens against the
   * same output budget, and they spend them BEFORE emitting any visible text.
   * A caller asking for 100 tokens from gpt-5 therefore gets an empty response
   * and a length finish reason, which looks like the model refusing to answer.
   *
   * Rather than making every call site remember this, enforce a floor here. The
   * budget is a ceiling and unused tokens are never billed, so raising a small
   * request costs nothing and removes an entire class of confusing failure.
   */
  const requested = req.maxTokens ?? conn.maxOutputTokens;
  // For a reasoning model the caller's figure describes the ANSWER they want,
  // while the budget has to cover reasoning plus that answer. Those differ by
  // an order of magnitude on a large prompt, and a caller asking for a
  // six-sentence reply has no way to know how much thinking it will take. So
  // reasoning models get the connection's full ceiling, which the user set
  // deliberately, rather than a per-call guess.
  const limit = reasoning ? Math.max(requested, conn.maxOutputTokens) : requested;

  const payload: Record<string, unknown> = {
    model: t.model,
    /*
     * A message with images becomes the OpenAI content-parts array; a plain
     * message stays a bare string. Both are valid in this dialect, and not
     * rewriting every message keeps the wire format identical to what it was
     * before images existed for the overwhelming majority of calls.
     */
    messages: req.messages.map((m) => (
      m.images?.length
        ? {
          role: m.role,
          content: [
            ...(m.content ? [{ type: 'text', text: m.content }] : []),
            ...m.images.map((image) => ({
              type: 'image_url',
              image_url: { url: `data:${image.mediaType};base64,${image.base64}` },
            })),
          ],
        }
        : { role: m.role, content: m.content }
    )),
  };
  if (reasoning) payload.max_completion_tokens = limit;
  else {
    payload.max_tokens = limit;
    payload.temperature = req.temperature ?? 0.2;
  }

  if (req.jsonSchema) {
    payload.response_format = t.supportsJsonSchema === false
      ? { type: 'json_object' }
      : {
        type: 'json_schema',
        json_schema: {
          name: 'pressbox_result',
          strict: schemaIsStrictReady(req.jsonSchema),
          schema: req.jsonSchema,
        },
      };
  }

  const started = Date.now();
  let res: Response;
  try {
    res = await fetch(t.url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...t.headers },
      body: JSON.stringify(payload),
      signal: req.signal,
    });
  } catch (cause) {
    const aborted = cause instanceof Error && cause.name === 'AbortError';
    throw new ModelError(
      aborted ? `${t.label} request was cancelled.` : `Could not reach ${t.url}: ${String(cause)}`,
      { provider: t.provider, retryable: !aborted },
    );
  }

  const raw = await res.text();
  if (!res.ok) {
    throw new ModelError(`${t.label} ${res.status}: ${extractErrorMessage(res.status, raw)}`, {
      provider: t.provider,
      status: res.status,
      retryable: retryableStatus(res.status),
    });
  }

  let body: ChatBody;
  try {
    body = JSON.parse(raw) as ChatBody;
  } catch {
    throw new ModelError(`${t.label} returned a body that was not JSON.`, { provider: t.provider, retryable: true });
  }

  const text = (body.choices?.[0]?.message?.content ?? '').trim();
  if (!text) {
    const reason = body.choices?.[0]?.finish_reason;
    throw new ModelError(
      reason === 'length'
        ? `${t.label} hit the output token limit before producing any text. Raise max output tokens on this connection.`
        : `${t.label} returned an empty completion.`,
      { provider: t.provider, retryable: reason !== 'length' },
    );
  }

  let json: unknown;
  if (req.jsonSchema) {
    try {
      json = JSON.parse(text);
    } catch {
      throw new ModelError(`${t.label} returned malformed JSON despite a schema being requested.`, {
        provider: t.provider,
        retryable: true,
      });
    }
  }

  return {
    text,
    json,
    inputTokens: body.usage?.prompt_tokens ?? 0,
    outputTokens: body.usage?.completion_tokens ?? 0,
    model: body.model ?? t.model,
    latencyMs: Date.now() - started,
  };
}

const DEFAULT_BASE_URL = 'https://api.openai.com/v1';

export const openaiProvider: ModelProvider = {
  id: 'openai',
  displayName: 'OpenAI',
  baseUrl: 'optional',
  needsApiKey: true,
  keyUrl: 'https://platform.openai.com/api-keys',
  suggestedModels: [
    { id: 'gpt-5', label: 'GPT-5 — deepest analysis', inputCost: 1.25, outputCost: 10 },
    { id: 'gpt-5-mini', label: 'GPT-5 mini — good default for briefs', inputCost: 0.25, outputCost: 2 },
    { id: 'gpt-4.1', label: 'GPT-4.1', inputCost: 2, outputCost: 8 },
    { id: 'gpt-4.1-mini', label: 'GPT-4.1 mini — fast + cheap for tagging', inputCost: 0.4, outputCost: 1.6 },
  ],

  complete(conn, req) {
    if (!conn.apiKey) {
      throw new ModelError('OpenAI connection has no API key.', { provider: 'openai', retryable: false });
    }
    const base = (conn.baseUrl || DEFAULT_BASE_URL).replace(/\/+$/, '');
    return chatCompletion({
      provider: 'openai',
      label: 'OpenAI',
      url: `${base}/chat/completions`,
      headers: { authorization: `Bearer ${conn.apiKey}` },
      model: conn.model,
    }, conn, req);
  },
};

export default openaiProvider;
