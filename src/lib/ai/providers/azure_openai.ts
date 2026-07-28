/**
 * Azure OpenAI Service.
 *
 * Same body as OpenAI, three different addressing rules — which is exactly why
 * generic "OpenAI-compatible" configs fail against Azure and users give up:
 *   - The model lives in the PATH as a deployment name, not in the body.
 *   - Auth is the `api-key` header, not `Authorization: Bearer`.
 *   - `api-version` is a required query parameter; omit it and you get a 404
 *     that looks like a wrong URL.
 *
 * Convention here: `conn.baseUrl` is the resource root
 * (https://my-resource.openai.azure.com), optionally with `?api-version=...` to
 * pin a version, and `conn.model` is the DEPLOYMENT name.
 */
import {
  ModelError,
  type CompletionRequest,
  type CompletionResult,
  type ModelProvider,
  type ResolvedModelConnection,
} from '../types';
import { chatCompletion } from './openai';

const DEFAULT_API_VERSION = '2024-10-21';

export const azureOpenAiProvider: ModelProvider = {
  id: 'azure_openai',
  displayName: 'Azure OpenAI',
  baseUrl: 'required',
  needsApiKey: true,
  keyUrl: 'https://learn.microsoft.com/azure/ai-services/openai/reference',
  suggestedModels: [
    { id: 'gpt-4o', label: 'Deployment of gpt-4o', inputCost: 2.5, outputCost: 10 },
    { id: 'gpt-4o-mini', label: 'Deployment of gpt-4o-mini', inputCost: 0.15, outputCost: 0.6 },
    { id: 'gpt-4.1', label: 'Deployment of gpt-4.1', inputCost: 2, outputCost: 8 },
  ],

  complete(conn: ResolvedModelConnection, req: CompletionRequest): Promise<CompletionResult> {
    if (!conn.baseUrl || !conn.baseUrl.trim()) {
      throw new ModelError(
        'Azure OpenAI needs the resource endpoint, e.g. https://my-resource.openai.azure.com.',
        { provider: 'azure_openai', retryable: false },
      );
    }
    if (!conn.apiKey) {
      throw new ModelError('Azure OpenAI connection has no API key.', { provider: 'azure_openai', retryable: false });
    }

    // Accept a base URL with or without an api-version already pinned on it.
    let root: URL;
    try {
      root = new URL(conn.baseUrl.trim());
    } catch {
      throw new ModelError(`"${conn.baseUrl}" is not a valid URL.`, { provider: 'azure_openai', retryable: false });
    }
    const apiVersion = root.searchParams.get('api-version') ?? DEFAULT_API_VERSION;
    const deployment = conn.model.trim();
    if (!deployment) {
      throw new ModelError(
        'Azure OpenAI needs a deployment name in the model field (the name you gave the deployment in Azure, not the base model).',
        { provider: 'azure_openai', retryable: false },
      );
    }

    const path = root.pathname.replace(/\/+$/, '');
    const base = `${root.origin}${path}`;
    const url = `${base}/openai/deployments/${encodeURIComponent(deployment)}`
      + `/chat/completions?api-version=${encodeURIComponent(apiVersion)}`;

    return chatCompletion({
      provider: 'azure_openai',
      label: 'Azure OpenAI',
      url,
      headers: { 'api-key': conn.apiKey },
      model: deployment,
    }, conn, req);
  },
};

export default azureOpenAiProvider;
