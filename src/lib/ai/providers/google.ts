/**
 * Google Gemini via the Generative Language API
 * (POST /v1beta/models/{model}:generateContent, header `x-goog-api-key`).
 *
 * Gemini's wire format differs from everyone else's in three ways we normalise:
 *   - Turns are `contents` with roles `user` / `model` (not `assistant`).
 *   - The system prompt is `systemInstruction`, a sibling of `contents`.
 *   - `responseSchema` accepts an OpenAPI 3.0 subset, NOT full JSON Schema.
 *     Keys like `$schema` and `additionalProperties` cause a 400, so we strip
 *     them rather than making every caller keep a second copy of its schema.
 */
import {
  ModelError,
  type CompletionRequest,
  type CompletionResult,
  type ModelProvider,
  type ResolvedModelConnection,
} from '../types';

const DEFAULT_BASE_URL = 'https://generativelanguage.googleapis.com/v1beta';

interface GeminiPart { text?: string }
interface GeminiCandidate { content?: { parts?: GeminiPart[] }; finishReason?: string }
interface GeminiBody {
  candidates?: GeminiCandidate[];
  modelVersion?: string;
  promptFeedback?: { blockReason?: string };
  usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number };
}

function retryableStatus(status: number): boolean {
  return status === 408 || status === 425 || status === 429 || status >= 500;
}

function errorMessage(status: number, body: string): string {
  try {
    const parsed: unknown = JSON.parse(body);
    const err = parsed && typeof parsed === 'object' ? (parsed as { error?: unknown }).error : null;
    if (err && typeof err === 'object' && 'message' in err) {
      const m = (err as { message?: unknown }).message;
      if (typeof m === 'string' && m.trim()) return m;
    }
  } catch { /* not JSON */ }
  return body.trim().slice(0, 400) || `HTTP ${status}`;
}

/** Gemini rejects JSON Schema vocabulary it does not implement. Drop it. */
const UNSUPPORTED_SCHEMA_KEYS = new Set([
  '$schema', '$id', '$ref', '$defs', 'definitions', 'additionalProperties',
  'patternProperties', 'oneOf', 'allOf', 'not', 'const', 'examples',
  'exclusiveMinimum', 'exclusiveMaximum', 'default',
]);

function toGeminiSchema(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(toGeminiSchema);
  if (!value || typeof value !== 'object') return value;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    if (UNSUPPORTED_SCHEMA_KEYS.has(k)) continue;
    out[k] = toGeminiSchema(v);
  }
  return out;
}

export const googleProvider: ModelProvider = {
  id: 'google',
  displayName: 'Google Gemini',
  baseUrl: 'optional',
  needsApiKey: true,
  keyUrl: 'https://aistudio.google.com/app/apikey',
  suggestedModels: [
    { id: 'gemini-2.5-pro', label: 'Gemini 2.5 Pro — deepest analysis', inputCost: 1.25, outputCost: 10 },
    { id: 'gemini-2.5-flash', label: 'Gemini 2.5 Flash — good default for briefs', inputCost: 0.3, outputCost: 2.5 },
    { id: 'gemini-2.5-flash-lite', label: 'Gemini 2.5 Flash-Lite — fast + cheap for tagging', inputCost: 0.1, outputCost: 0.4 },
  ],

  async complete(conn: ResolvedModelConnection, req: CompletionRequest): Promise<CompletionResult> {
    if (!conn.apiKey) {
      throw new ModelError('Google connection has no API key.', { provider: 'google', retryable: false });
    }
    const base = (conn.baseUrl || DEFAULT_BASE_URL).replace(/\/+$/, '');
    const model = conn.model.replace(/^models\//, '');

    const system = req.messages.filter((m) => m.role === 'system')
      .map((m) => m.content.trim()).filter(Boolean).join('\n\n');
    const contents = req.messages
      .filter((m) => m.role !== 'system')
      .map((m) => ({ role: m.role === 'assistant' ? 'model' : 'user', parts: [{ text: m.content }] }));
    if (contents.length === 0) contents.push({ role: 'user', parts: [{ text: 'Proceed.' }] });

    const generationConfig: Record<string, unknown> = {
      maxOutputTokens: req.maxTokens ?? conn.maxOutputTokens,
      temperature: req.temperature ?? 0.2,
    };
    if (req.jsonSchema) {
      generationConfig.responseMimeType = 'application/json';
      generationConfig.responseSchema = toGeminiSchema(req.jsonSchema);
    }

    const payload: Record<string, unknown> = { contents, generationConfig };
    if (system) payload.systemInstruction = { parts: [{ text: system }] };

    const started = Date.now();
    let res: Response;
    try {
      res = await fetch(`${base}/models/${encodeURIComponent(model)}:generateContent`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-goog-api-key': conn.apiKey },
        body: JSON.stringify(payload),
        signal: req.signal,
      });
    } catch (cause) {
      const aborted = cause instanceof Error && cause.name === 'AbortError';
      throw new ModelError(
        aborted ? 'Gemini request was cancelled.' : `Could not reach ${base}: ${String(cause)}`,
        { provider: 'google', retryable: !aborted },
      );
    }

    const raw = await res.text();
    if (!res.ok) {
      throw new ModelError(`Gemini ${res.status}: ${errorMessage(res.status, raw)}`, {
        provider: 'google',
        status: res.status,
        retryable: retryableStatus(res.status),
      });
    }

    let body: GeminiBody;
    try {
      body = JSON.parse(raw) as GeminiBody;
    } catch {
      throw new ModelError('Gemini returned a body that was not JSON.', { provider: 'google', retryable: true });
    }

    const candidate = body.candidates?.[0];
    const text = (candidate?.content?.parts ?? [])
      .map((p) => p.text ?? '').join('').trim();

    if (!text) {
      const blocked = body.promptFeedback?.blockReason;
      const finish = candidate?.finishReason;
      // A safety block is a property of the prompt, so retrying is pointless.
      throw new ModelError(
        blocked
          ? `Gemini blocked the request (${blocked}).`
          : finish === 'MAX_TOKENS'
            ? 'Gemini hit the output token limit before producing text. Raise max output tokens on this connection.'
            : 'Gemini returned an empty completion.',
        { provider: 'google', retryable: !blocked && finish !== 'MAX_TOKENS' },
      );
    }

    let json: unknown;
    if (req.jsonSchema) {
      try {
        json = JSON.parse(text);
      } catch {
        throw new ModelError('Gemini returned malformed JSON despite a response schema.', {
          provider: 'google',
          retryable: true,
        });
      }
    }

    return {
      text,
      json,
      inputTokens: body.usageMetadata?.promptTokenCount ?? 0,
      outputTokens: body.usageMetadata?.candidatesTokenCount ?? 0,
      model: body.modelVersion ?? conn.model,
      latencyMs: Date.now() - started,
    };
  },
};

export default googleProvider;
