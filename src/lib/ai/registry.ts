/**
 * The provider table.
 *
 * Every provider Pressbox knows how to speak to is listed here exactly once,
 * keyed by the same identifiers as the `model_provider` Postgres enum. Settings
 * renders the picker straight off listProviders(), so adding a provider is one
 * file plus one entry — no UI work, no migration beyond the enum.
 *
 * Bedrock is present but unimplemented on purpose. A provider that is silently
 * missing looks like a bug to the user; a provider that says exactly what is
 * and is not supported, and points at the workaround, is documentation. It also
 * keeps the Record exhaustive over ModelProviderId, so TypeScript tells us the
 * moment a new provider id is added to the union without an implementation.
 */
import {
  ModelError,
  type ModelProvider,
  type ModelProviderId,
} from './types';
import { anthropicProvider } from './providers/anthropic';
import { openaiProvider } from './providers/openai';
import { googleProvider } from './providers/google';
import { azureOpenAiProvider } from './providers/azure_openai';
import { openaiCompatibleProvider } from './providers/openai_compatible';
import { ollamaProvider } from './providers/ollama';

/**
 * AWS Bedrock needs SigV4 request signing against a credential chain (static
 * keys, STS, or an instance role), which is a materially different auth model
 * from every other provider here and not something to half-ship. Until it is
 * done properly, fail loudly with the workaround: Bedrock's OpenAI-compatible
 * gateway, or an LiteLLM/Bedrock-access-gateway proxy in front of it, both work
 * today through the openai_compatible provider.
 */
const bedrockProvider: ModelProvider = {
  id: 'bedrock',
  displayName: 'AWS Bedrock (not yet implemented)',
  baseUrl: 'optional',
  needsApiKey: true,
  keyUrl: 'https://docs.aws.amazon.com/bedrock/latest/userguide/api-setup.html',
  suggestedModels: [],
  complete() {
    return Promise.reject(new ModelError(
      'AWS Bedrock is not yet implemented in Pressbox because it requires SigV4 request signing. '
      + 'In the meantime, put an OpenAI-compatible gateway in front of Bedrock (LiteLLM, or the AWS '
      + 'bedrock-access-gateway) and configure it here as an "OpenAI-compatible endpoint".',
      { provider: 'bedrock', retryable: false },
    ));
  },
};

export const PROVIDERS: Record<ModelProviderId, ModelProvider> = {
  anthropic: anthropicProvider,
  openai: openaiProvider,
  google: googleProvider,
  azure_openai: azureOpenAiProvider,
  bedrock: bedrockProvider,
  openai_compatible: openaiCompatibleProvider,
  ollama: ollamaProvider,
};

/** Display order for the Settings picker: hosted first, then bring-your-own-host. */
const DISPLAY_ORDER: ModelProviderId[] = [
  'anthropic', 'openai', 'google', 'azure_openai',
  'openai_compatible', 'ollama', 'bedrock',
];

export function getProvider(id: ModelProviderId): ModelProvider {
  const provider = PROVIDERS[id];
  if (!provider) {
    throw new ModelError(
      `Unknown model provider "${id}". Known providers: ${DISPLAY_ORDER.join(', ')}.`,
      { provider: id, retryable: false },
    );
  }
  return provider;
}

export function listProviders(): ModelProvider[] {
  return DISPLAY_ORDER.map((id) => PROVIDERS[id]);
}

/** True when the provider can actually run a completion (Settings hides the rest). */
export function isProviderImplemented(id: ModelProviderId): boolean {
  return id !== 'bedrock';
}
