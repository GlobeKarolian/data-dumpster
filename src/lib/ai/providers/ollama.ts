/**
 * Ollama (POST {baseUrl}/api/chat).
 *
 * This is the option that runs entirely inside the firewall: the model weights,
 * the inference, and every post, caption and competitor URL Data Dumpster sends to
 * it stay on hardware the newsroom owns. No API key, no vendor account, no
 * egress. For an outlet that cannot send unpublished editorial signal to a
 * third party — legal, embargo, or simple policy — this is the whole reason
 * bring-your-own-model exists.
 *
 * Wire notes: Ollama's chat endpoint has its own shape, not OpenAI's (Ollama
 * also exposes an /v1 compatibility layer — point the openai_compatible
 * provider at that if you prefer). With streaming disabled the response is a
 * single JSON object; token counts arrive as prompt_eval_count / eval_count.
 * Since 0.5 the "format" field accepts a JSON Schema and constrains decoding,
 * which is how we get structured output out of a local model reliably.
 */
import {
  ModelError,
  type CompletionRequest,
  type CompletionResult,
  type ModelProvider,
  type ResolvedModelConnection,
} from '../types';

const DEFAULT_BASE_URL = 'http://127.0.0.1:11434';

interface OllamaBody {
  model?: string;
  message?: { role?: string; content?: string };
  done_reason?: string;
  prompt_eval_count?: number;
  eval_count?: number;
  error?: string;
}

function retryableStatus(status: number): boolean {
  return status === 408 || status === 429 || status >= 500;
}

function errorMessage(status: number, body: string): string {
  try {
    const parsed: unknown = JSON.parse(body);
    if (parsed && typeof parsed === 'object') {
      const e = (parsed as { error?: unknown }).error;
      if (typeof e === 'string' && e.trim()) return e;
    }
  } catch { /* not JSON */ }
  return body.trim().slice(0, 400) || `HTTP ${status}`;
}

export const ollamaProvider: ModelProvider = {
  id: 'ollama',
  displayName: 'Ollama (local — runs entirely inside your firewall)',
  baseUrl: 'optional',
  needsApiKey: false,
  keyUrl: 'https://ollama.com/download',
  suggestedModels: [
    { id: 'llama3.3:70b', label: 'Llama 3.3 70B — best local quality, needs ~40GB', inputCost: 0, outputCost: 0 },
    { id: 'qwen3:32b', label: 'Qwen3 32B — strong analysis on one GPU', inputCost: 0, outputCost: 0 },
    { id: 'gpt-oss:20b', label: 'gpt-oss 20B — good local default for briefs', inputCost: 0, outputCost: 0 },
    { id: 'llama3.1:8b', label: 'Llama 3.1 8B — runs on a laptop, fine for tagging', inputCost: 0, outputCost: 0 },
  ],

  async complete(conn: ResolvedModelConnection, req: CompletionRequest): Promise<CompletionResult> {
    const base = (conn.baseUrl || DEFAULT_BASE_URL).trim().replace(/\/+$/, '').replace(/\/api$/, '');

    const payload: Record<string, unknown> = {
      model: conn.model,
      messages: req.messages.map((m) => ({ role: m.role, content: m.content })),
      stream: false,
      options: {
        temperature: req.temperature ?? 0.2,
        num_predict: req.maxTokens ?? conn.maxOutputTokens,
      },
    };
    if (req.jsonSchema) payload.format = req.jsonSchema;

    const started = Date.now();
    let res: Response;
    try {
      res = await fetch(base + '/api/chat', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          // Unused locally, but lets an org front Ollama with an authenticating proxy.
          ...(conn.apiKey ? { authorization: `Bearer ${conn.apiKey}` } : {}),
        },
        body: JSON.stringify(payload),
        signal: req.signal,
      });
    } catch (cause) {
      const aborted = cause instanceof Error && cause.name === 'AbortError';
      throw new ModelError(
        aborted
          ? 'Ollama request was cancelled.'
          : `Could not reach Ollama at ${base}. Is the daemon running? (${String(cause)})`,
        { provider: 'ollama', retryable: !aborted },
      );
    }

    const raw = await res.text();
    if (!res.ok) {
      const detail = errorMessage(res.status, raw);
      // A missing model is a setup problem with an exact fix, so name the fix.
      const hint = res.status === 404 && /model/i.test(detail)
        ? ` Pull it onto the host first, then retry.`
        : '';
      throw new ModelError(`Ollama ${res.status}: ${detail}.${hint}`, {
        provider: 'ollama',
        status: res.status,
        retryable: retryableStatus(res.status),
      });
    }

    let body: OllamaBody;
    try {
      body = JSON.parse(raw) as OllamaBody;
    } catch {
      throw new ModelError('Ollama returned a body that was not JSON.', { provider: 'ollama', retryable: true });
    }
    if (body.error) {
      throw new ModelError(`Ollama: ${body.error}`, { provider: 'ollama', retryable: false });
    }

    const text = (body.message?.content ?? '').trim();
    if (!text) {
      const truncated = body.done_reason === 'length';
      throw new ModelError(
        truncated
          ? 'Ollama hit the output token limit before producing text. Raise max output tokens on this connection.'
          : 'Ollama returned an empty completion.',
        { provider: 'ollama', retryable: !truncated },
      );
    }

    let json: unknown;
    if (req.jsonSchema) {
      try {
        json = JSON.parse(text);
      } catch {
        throw new ModelError('Ollama returned malformed JSON despite a schema being requested.', {
          provider: 'ollama',
          retryable: true,
        });
      }
    }

    return {
      text,
      json,
      inputTokens: body.prompt_eval_count ?? 0,
      outputTokens: body.eval_count ?? 0,
      model: body.model ?? conn.model,
      latencyMs: Date.now() - started,
    };
  },
};

export default ollamaProvider;
