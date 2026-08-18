/**
 * Anthropic Messages API (POST /v1/messages).
 *
 * Two shape details matter and are easy to get wrong:
 *   1. The system prompt is a TOP-LEVEL `system` field, not a message with
 *      role:'system'. Anthropic rejects role:'system' inside `messages`.
 *   2. Turns must alternate user/assistant and begin with a user turn, so we
 *      coalesce adjacent same-role messages rather than trusting the caller.
 *
 * Structured output is done with a forced tool call rather than a "please reply
 * with JSON" instruction. Forcing `tool_choice` makes the API itself enforce the
 * schema, which is the difference between usually-valid JSON and always-valid
 * JSON. Data Dumpster parses these results into user-visible tables, so "usually" is
 * not good enough.
 */
import {
  ModelError,
  type CompletionRequest,
  type CompletionResult,
  type ModelMessage,
  type ModelProvider,
  type ResolvedModelConnection,
} from '../types';

const ANTHROPIC_VERSION = '2023-06-01';
const DEFAULT_BASE_URL = 'https://api.anthropic.com';
const JSON_TOOL_NAME = 'emit_result';

interface AnthropicBlock { type: string; text?: string; name?: string; input?: unknown }
interface AnthropicBody {
  model?: string;
  content?: AnthropicBlock[];
  usage?: { input_tokens?: number; output_tokens?: number };
}

/** 429 and 5xx are transient. 4xx below 429 means the request itself is wrong. */
function retryableStatus(status: number): boolean {
  return status === 408 || status === 425 || status === 429 || status >= 500;
}

function errorMessage(status: number, body: string): string {
  try {
    const parsed: unknown = JSON.parse(body);
    if (parsed && typeof parsed === 'object' && 'error' in parsed) {
      const err = (parsed as { error?: unknown }).error;
      if (err && typeof err === 'object' && 'message' in err) {
        const m = (err as { message?: unknown }).message;
        if (typeof m === 'string' && m.trim()) return m;
      }
    }
  } catch { /* body was not JSON; fall through to the raw text */ }
  return body.trim().slice(0, 400) || `HTTP ${status}`;
}

type AnthropicContent = string | AnthropicBlock[];

function splitSystem(messages: ModelMessage[]): {
  system: string;
  turns: { role: 'user' | 'assistant'; content: AnthropicContent }[];
} {
  const system = messages
    .filter((m) => m.role === 'system')
    .map((m) => m.content.trim())
    .filter(Boolean)
    .join('\n\n');

  const turns: { role: 'user' | 'assistant'; content: AnthropicContent }[] = [];
  const blocksFor = (m: ModelMessage): AnthropicContent => (
    m.images?.length
      ? [
        ...(m.content ? [{ type: 'text' as const, text: m.content }] : []),
        ...m.images.map((image) => ({
          type: 'image' as const,
          source: { type: 'base64' as const, media_type: image.mediaType, data: image.base64 },
        })),
      ] as AnthropicBlock[]
      : m.content
  );
  for (const m of messages) {
    if (m.role === 'system') continue;
    const last = turns[turns.length - 1];
    // Only coalesce plain text turns. Concatenating a block array with a
    // string would silently drop the image blocks.
    if (last && last.role === m.role
      && typeof last.content === 'string' && !m.images?.length) {
      last.content = `${last.content}\n\n${m.content}`;
    } else {
      turns.push({ role: m.role, content: blocksFor(m) });
    }
  }
  if (turns.length === 0 || turns[0].role !== 'user') {
    turns.unshift({ role: 'user', content: 'Proceed.' });
  }
  return { system, turns };
}

export const anthropicProvider: ModelProvider = {
  id: 'anthropic',
  displayName: 'Anthropic',
  baseUrl: 'optional',
  needsApiKey: true,
  keyUrl: 'https://console.anthropic.com/settings/keys',
  suggestedModels: [
    { id: 'claude-opus-5', label: 'Claude Opus 5 — deepest analysis', inputCost: 15, outputCost: 75 },
    { id: 'claude-sonnet-5', label: 'Claude Sonnet 5 — best default for briefs', inputCost: 3, outputCost: 15 },
    { id: 'claude-haiku-4-5-20251001', label: 'Claude Haiku 4.5 — fast + cheap for tagging', inputCost: 1, outputCost: 5 },
  ],

  async complete(conn: ResolvedModelConnection, req: CompletionRequest): Promise<CompletionResult> {
    if (!conn.apiKey) {
      throw new ModelError('Anthropic connection has no API key.', { provider: 'anthropic', retryable: false });
    }
    const base = (conn.baseUrl || DEFAULT_BASE_URL).replace(/\/+$/, '');
    const { system, turns } = splitSystem(req.messages);

    const payload: Record<string, unknown> = {
      model: conn.model,
      max_tokens: req.maxTokens ?? conn.maxOutputTokens,
      temperature: req.temperature ?? 0.2,
      messages: turns,
    };
    if (system) payload.system = system;
    if (req.jsonSchema) {
      payload.tools = [{
        name: JSON_TOOL_NAME,
        description: 'Return the final answer as structured data matching the schema.',
        input_schema: req.jsonSchema,
      }];
      payload.tool_choice = { type: 'tool', name: JSON_TOOL_NAME };
    }

    const started = Date.now();
    let res: Response;
    try {
      res = await fetch(`${base}/v1/messages`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-api-key': conn.apiKey,
          'anthropic-version': ANTHROPIC_VERSION,
        },
        body: JSON.stringify(payload),
        signal: req.signal,
      });
    } catch (cause) {
      const aborted = cause instanceof Error && cause.name === 'AbortError';
      throw new ModelError(
        aborted ? 'Anthropic request was cancelled.' : `Could not reach ${base}: ${String(cause)}`,
        { provider: 'anthropic', retryable: !aborted },
      );
    }

    const raw = await res.text();
    if (!res.ok) {
      throw new ModelError(`Anthropic ${res.status}: ${errorMessage(res.status, raw)}`, {
        provider: 'anthropic',
        status: res.status,
        retryable: retryableStatus(res.status),
      });
    }

    let body: AnthropicBody;
    try {
      body = JSON.parse(raw) as AnthropicBody;
    } catch {
      throw new ModelError('Anthropic returned a body that was not JSON.', { provider: 'anthropic', retryable: true });
    }

    const blocks = body.content ?? [];
    const text = blocks.filter((b) => b.type === 'text' && typeof b.text === 'string')
      .map((b) => b.text as string).join('').trim();

    let json: unknown;
    let jsonText = '';
    if (req.jsonSchema) {
      const call = blocks.find((b) => b.type === 'tool_use' && b.name === JSON_TOOL_NAME);
      if (!call) {
        throw new ModelError('Anthropic did not return the forced structured-output tool call.', {
          provider: 'anthropic',
          retryable: true,
        });
      }
      json = call.input;
      jsonText = JSON.stringify(call.input);
    }

    return {
      text: jsonText || text,
      json,
      inputTokens: body.usage?.input_tokens ?? 0,
      outputTokens: body.usage?.output_tokens ?? 0,
      model: body.model ?? conn.model,
      latencyMs: Date.now() - started,
    };
  },
};

export default anthropicProvider;
