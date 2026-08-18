/**
 * Bring-your-own-model contract.
 *
 * Data Dumpster never ships a hosted model. An org points it at inference they already
 * control — their Anthropic account, their Azure deployment, an Ollama box behind
 * the firewall — and Data Dumpster adapts. Three consequences that matter to a newsroom:
 *   1. No newsroom content leaves for a vendor the newsroom did not choose.
 *   2. Model spend is the org's own line item, visible and capped, not a markup.
 *   3. When a better model ships on a Tuesday, you switch on Tuesday.
 */
export type ModelProviderId =
  | 'anthropic' | 'openai' | 'google' | 'azure_openai'
  | 'bedrock' | 'openrouter' | 'openai_compatible' | 'ollama';

/**
 * An image attached to a message.
 *
 * Kept as a sibling of `content` rather than turning `content` into a parts
 * union, because every provider encodes image parts differently and a union
 * would push that difference into every call site. Providers that cannot send
 * images fail loudly in their own dialect instead of dropping the attachment,
 * which would otherwise produce a confident answer about an image the model
 * never saw.
 */
export interface ModelImage {
  /** e.g. 'image/png'. */
  mediaType: string;
  /** Raw base64, no data: prefix. */
  base64: string;
}

export interface ModelMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
  images?: ModelImage[];
}

export interface CompletionRequest {
  messages: ModelMessage[];
  maxTokens?: number;
  temperature?: number;
  /** When set, the provider is asked for JSON matching this JSON Schema. */
  jsonSchema?: Record<string, unknown>;
  signal?: AbortSignal;
}

export interface CompletionResult {
  text: string;
  inputTokens: number;
  outputTokens: number;
  model: string;
  latencyMs: number;
  /** Populated when jsonSchema was supplied and parsing succeeded. */
  json?: unknown;
  /**
   * The provider's own statement of what this completion cost, in USD.
   * OpenRouter reports it when asked (usage accounting); most providers don't.
   * When present it beats any per-Mtok estimate: it is the charged amount,
   * discounts and provider routing included, not our arithmetic about it.
   */
  reportedCostUsd?: number;
}

/** Runtime config for one configured connection, after decryption. */
export interface ResolvedModelConnection {
  id: string;
  orgId: string;
  label: string;
  provider: ModelProviderId;
  model: string;
  baseUrl?: string | null;
  apiKey?: string | null;
  maxOutputTokens: number;
  inputCostPerMtok?: number | null;
  outputCostPerMtok?: number | null;
}

export interface ModelProvider {
  id: ModelProviderId;
  displayName: string;
  /** Whether baseUrl is required, optional, or ignored. */
  baseUrl: 'required' | 'optional' | 'none';
  needsApiKey: boolean;
  /** Suggested models shown in the picker. Free text is always allowed. */
  suggestedModels: { id: string; label: string; inputCost?: number; outputCost?: number }[];
  /** Docs link so a user can go get a key without guessing. */
  keyUrl?: string;
  complete(conn: ResolvedModelConnection, req: CompletionRequest): Promise<CompletionResult>;
}

export class ModelError extends Error {
  constructor(message: string, readonly opts: { provider: ModelProviderId; status?: number; retryable?: boolean }) {
    super(message);
    this.name = 'ModelError';
  }
}
