/**
 * GET /api/settings/models/providers -- the picker's menu.
 *
 * The registry entries carry a complete() function, which cannot cross the
 * server boundary, so this endpoint projects each provider down to the
 * serializable slice the settings form actually renders. That projection is
 * also the security property: there is nothing in a ModelProvider definition
 * that is secret, and by listing the fields explicitly rather than spreading
 * the object, a field added to the registry later cannot leak here by accident.
 *
 * The response mirrors ProviderInfo in components/settings/provider-info.ts --
 * including "implemented", which the form uses to disable the Bedrock option
 * rather than let someone save a connection that can never run.
 */
import { apiHandler, requireOrg } from '@/lib/session';
import { isProviderImplemented, listProviders } from '@/lib/ai/registry';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const GET = apiHandler(async () => {
  await requireOrg();

  const items = listProviders().map((p) => ({
    id: p.id,
    displayName: p.displayName,
    baseUrl: p.baseUrl,
    needsApiKey: p.needsApiKey,
    keyUrl: p.keyUrl,
    suggestedModels: p.suggestedModels,
    implemented: isProviderImplemented(p.id),
  }));

  return Response.json({ items }, { headers: { 'cache-control': 'private, no-store' } });
});
