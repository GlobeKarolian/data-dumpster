/**
 * OpenRouter: one API key, every major model, OpenAI Chat Completions dialect.
 *
 * OpenRouter is a router in front of Anthropic, OpenAI, Google, Meta, DeepSeek
 * and dozens of smaller hosts. For a newsroom that wants to compare models or
 * switch weekly without opening a new vendor account each time, it is the
 * shortest path — one bill, one key, models addressed as "vendor/model".
 *
 * It was already reachable through the "OpenAI-compatible endpoint" escape
 * hatch, but first-class support removes the two setup mistakes we saw coming:
 * a mistyped base URL, and a key pasted into the generic slot with no shape
 * check. The base URL is fixed here on purpose — there is exactly one
 * OpenRouter, so asking for a URL is asking for a typo.
 *
 * Structured output: OpenRouter forwards response_format to the underlying
 * host, and not every host speaks json_schema. Same conservative negotiation
 * as the compatible provider: try the schema, fall back once to json_object.
 */
import {
  ModelError,
  type CompletionRequest,
  type CompletionResult,
  type ModelProvider,
  type ResolvedModelConnection,
} from '../types';
import { chatCompletion } from './openai';

const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions';

function looksLikeUnsupportedResponseFormat(err: unknown): boolean {
  if (!(err instanceof ModelError)) return false;
  if (err.opts.status !== 400 && err.opts.status !== 422) return false;
  return /response_format|json_schema|schema|unsupported|unrecognized|unknown field/i.test(err.message);
}

export const openrouterProvider: ModelProvider = {
  id: 'openrouter',
  displayName: 'OpenRouter',
  baseUrl: 'none',
  needsApiKey: true,
  keyUrl: 'https://openrouter.ai/settings/keys',
  // Model ids are "vendor/model" on OpenRouter. Costs are deliberately not
  // listed: OpenRouter prices float with the underlying hosts, and a stale
  // number shown as truth is worse than none. The picker allows free text.
  suggestedModels: [
    { id: 'anthropic/claude-sonnet-4.5', label: 'Claude Sonnet 4.5' },
    { id: 'openai/gpt-4.1-mini', label: 'GPT-4.1 mini' },
    { id: 'google/gemini-2.5-flash', label: 'Gemini 2.5 Flash' },
    { id: 'meta-llama/llama-3.3-70b-instruct', label: 'Llama 3.3 70B' },
    { id: 'deepseek/deepseek-chat-v3-0324', label: 'DeepSeek V3' },
  ],

  async complete(conn: ResolvedModelConnection, req: CompletionRequest): Promise<CompletionResult> {
    if (!conn.apiKey) {
      throw new ModelError(
        'This OpenRouter connection has no API key. Create one at https://openrouter.ai/settings/keys '
        + 'and paste it into the connection.',
        { provider: 'openrouter', retryable: false },
      );
    }
    const transport = {
      provider: 'openrouter' as const,
      label: 'OpenRouter',
      url: OPENROUTER_URL,
      headers: {
        authorization: `Bearer ${conn.apiKey}`,
        // App attribution, per OpenRouter's docs. Optional, never identifying:
        // these name the calling product, not the org or the user.
        'http-referer': 'https://www.datadumpster.boston',
        'x-title': 'Data Dumpster',
      },
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

export default openrouterProvider;
