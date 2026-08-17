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

export interface ModelMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
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
