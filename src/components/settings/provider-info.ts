import type { ModelProviderId } from '@/lib/ai/types';

/**
 * The serializable slice of a provider definition.
 *
 * The provider registry carries a `complete` function, which cannot cross the
 * server boundary. This is the shape the settings client gets: everything it
 * needs to render a form and nothing it could call.
 */
export interface ProviderInfo {
  id: ModelProviderId;
  displayName: string;
  baseUrl: 'required' | 'optional' | 'none';
  needsApiKey: boolean;
  keyUrl?: string;
  suggestedModels: { id: string; label: string; inputCost?: number; outputCost?: number }[];
  implemented: boolean;
}

/** One line of plain speech per provider, for the form. Not marketing copy. */
export const PROVIDER_NOTE: Record<ModelProviderId, string> = {
  anthropic: 'Your own Anthropic API key. Billing lands on your Anthropic account, not on a Data Dumpster invoice.',
  openai: 'Your own OpenAI key, on your organization’s existing quota and data-retention terms.',
  google: 'Gemini through the Google AI API, using a key from your Google Cloud project.',
  azure_openai: 'An Azure OpenAI deployment inside your own tenant, with your region and your compliance boundary.',
  bedrock: 'Not yet implemented. Put an OpenAI-compatible gateway in front of Bedrock and configure that instead.',
  openrouter: 'One key for every major model, routed through OpenRouter. Models are addressed as "vendor/model", and billing lands on your OpenRouter account.',
  openai_compatible: 'Any endpoint that speaks the OpenAI chat API — vLLM, LiteLLM, Together, Groq, an internal proxy.',
  ollama: 'A model running on hardware you control. Nothing leaves the building, which for some stories is the whole requirement.',
};
