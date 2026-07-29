/**
 * Any endpoint that speaks the OpenAI Chat Completions dialect.
 *
 * This is the escape hatch that keeps Data Dumpster honest about "bring your own
 * model": Groq, Together, Fireworks, DeepInfra, OpenRouter, Perplexity, a vLLM
 * or SGLang box in your own rack, LM Studio on a laptop. If it accepts
 * POST {baseUrl}/chat/completions, it works here — no release of ours required.
 *
 * `baseUrl` is required precisely because guessing it is how you accidentally
 * ship a newsroom's content to the wrong vendor. The user names the host.
 *
 * Structured output is negotiated conservatively: many of these servers accept
 * `response_format: {type:'json_object'}` but not `json_schema`, and a 400 from
 * an unknown parameter is indistinguishable from a real failure. So we try the
 * schema first and fall back once to json_object rather than failing the user's
 * request over a capability difference.
 */
import {
  ModelError,
  type CompletionRequest,
  type CompletionResult,
  type ModelProvider,
  type ResolvedModelConnection,
} from '../types';
import { chatCompletion } from './openai';

/** Normalise the handful of ways people write a base URL for these hosts. */
function endpoint(baseUrl: string): string {
  let base = baseUrl.trim().replace(/\/+$/, '');
  if (/\/chat\/completions$/.test(base)) return base;
  if (!/\/v\d+$/.test(base) && !/\/api$/.test(base)) base = `${base}/v1`;
  return `${base}/chat/completions`;
}

function looksLikeUnsupportedResponseFormat(err: unknown): boolean {
  if (!(err instanceof ModelError)) return false;
  if (err.opts.status !== 400 && err.opts.status !== 422) return false;
  return /response_format|json_schema|schema|unsupported|unrecognized|unknown field/i.test(err.message);
}

export const openaiCompatibleProvider: ModelProvider = {
  id: 'openai_compatible',
  displayName: 'OpenAI-compatible endpoint',
  baseUrl: 'required',
  needsApiKey: false,
  keyUrl: 'https://platform.openai.com/docs/api-reference/chat',
  suggestedModels: [
    { id: 'llama-3.3-70b-versatile', label: 'Llama 3.3 70B (Groq)', inputCost: 0.59, outputCost: 0.79 },
    { id: 'meta-llama/Llama-3.3-70B-Instruct-Turbo', label: 'Llama 3.3 70B (Together)', inputCost: 0.88, outputCost: 0.88 },
    { id: 'accounts/fireworks/models/deepseek-v3', label: 'DeepSeek V3 (Fireworks)', inputCost: 0.9, outputCost: 0.9 },
    { id: 'qwen/qwen3-32b', label: 'Qwen3 32B (self-hosted vLLM)' },
    { id: 'openai/gpt-4.1-mini', label: 'GPT-4.1 mini (OpenRouter)', inputCost: 0.4, outputCost: 1.6 },
  ],

  async complete(conn: ResolvedModelConnection, req: CompletionRequest): Promise<CompletionResult> {
    if (!conn.baseUrl || !conn.baseUrl.trim()) {
      throw new ModelError(
        'This connection needs a base URL, e.g. https://api.groq.com/openai/v1 or http://localhost:8000/v1.',
        { provider: 'openai_compatible', retryable: false },
      );
    }
    const url = endpoint(conn.baseUrl);
    const headers: Record<string, string> = {};
    // Local servers (vLLM, LM Studio) usually accept any bearer or none at all.
    if (conn.apiKey) headers.authorization = `Bearer ${conn.apiKey}`;

    const transport = {
      provider: 'openai_compatible' as const,
      label: 'Endpoint',
      url,
      headers,
      model: conn.model,
    };

    try {
      return await chatCompletion(transport, conn, req);
    } catch (err) {
      if (req.jsonSchema && looksLikeUnsupportedResponseFormat(err)) {
        return chatCompletion({ ...transport, supportsJsonSchema: false }, conn, req);
      }
      throw err;
    }
  },
};

export default openaiCompatibleProvider;
