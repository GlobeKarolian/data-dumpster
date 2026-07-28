'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { ExternalLink, KeyRound, Loader2 } from 'lucide-react';
import type { ModelProviderId } from '@/lib/ai/types';
import { Button } from '@/components/ui/button';
import { Field, Input, FieldHint } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { Toggle } from '@/components/ui/toggle';
import { PROVIDER_NOTE, type ProviderInfo } from './provider-info';

export interface ModelConnectionFormProps {
  providers: ProviderInfo[];
  onDone: () => void;
  onCancel: () => void;
}

/**
 * Adding a connection.
 *
 * Three details do the work here. The model field is a dropdown seeded with the
 * provider's own suggestions but stays free text, because a model shipped on a
 * Tuesday should be usable on Tuesday. The base URL appears only for providers
 * that need one, so nobody has to guess whether it is optional. And the key is
 * write-only from the moment it is submitted: it is encrypted at rest and only
 * ever displayed masked, including to the person who typed it.
 */
export function ModelConnectionForm({ providers, onDone, onCancel }: ModelConnectionFormProps) {
  const router = useRouter();
  const usable = providers.filter((p) => p.implemented);
  const [providerId, setProviderId] = React.useState<ModelProviderId>(usable[0]?.id ?? 'anthropic');
  const provider = providers.find((p) => p.id === providerId) ?? usable[0];

  const [label, setLabel] = React.useState('');
  const [model, setModel] = React.useState(provider?.suggestedModels[0]?.id ?? '');
  const [baseUrl, setBaseUrl] = React.useState('');
  const [apiKey, setApiKey] = React.useState('');
  const [inputCost, setInputCost] = React.useState('');
  const [outputCost, setOutputCost] = React.useState('');
  const [maxOutputTokens, setMaxOutputTokens] = React.useState('4096');
  const [isDefault, setIsDefault] = React.useState(true);
  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  // Switching provider reseeds the model and its prices during the same render
  // pass, so the form never briefly shows an OpenAI model under Anthropic.
  const [seededFor, setSeededFor] = React.useState<ModelProviderId>(providerId);
  if (seededFor !== providerId) {
    const suggested = provider?.suggestedModels[0];
    setSeededFor(providerId);
    setModel(suggested?.id ?? '');
    setInputCost(suggested?.inputCost !== undefined ? String(suggested.inputCost) : '');
    setOutputCost(suggested?.outputCost !== undefined ? String(suggested.outputCost) : '');
    if (provider?.baseUrl === 'none') setBaseUrl('');
  }

  const pickSuggested = (id: string) => {
    setModel(id);
    const found = provider?.suggestedModels.find((m) => m.id === id);
    if (found?.inputCost !== undefined) setInputCost(String(found.inputCost));
    if (found?.outputCost !== undefined) setOutputCost(String(found.outputCost));
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!model.trim()) {
      setError('Name the model you want this connection to call.');
      return;
    }
    if (provider?.baseUrl === 'required' && !baseUrl.trim()) {
      setError('This provider needs a base URL.');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const res = await fetch('/api/settings/models', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          label: label.trim() || (provider?.displayName ?? providerId),
          provider: providerId,
          model: model.trim(),
          baseUrl: baseUrl.trim() || null,
          apiKey: apiKey.trim() || null,
          inputCostPerMtok: inputCost === '' ? null : Number(inputCost),
          outputCostPerMtok: outputCost === '' ? null : Number(outputCost),
          maxOutputTokens: Number(maxOutputTokens) || 4096,
          isDefault,
        }),
      });
      if (!res.ok) {
        const detail = await res.text();
        throw new Error(detail.slice(0, 300) || 'Save failed with status ' + res.status + '.');
      }
      router.refresh();
      onDone();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save the connection.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <form onSubmit={submit} className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Provider" hint={PROVIDER_NOTE[providerId]}>
          <Select
            value={providerId}
            onChange={(e) => setProviderId(e.target.value as ModelProviderId)}
            options={providers.map((p) => ({
              value: p.id,
              label: p.displayName,
              disabled: !p.implemented,
            }))}
          />
        </Field>
        <Field label="Label" hint="How this connection is referred to in briefs and usage records.">
          <Input
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            placeholder={provider?.displayName ?? 'Primary model'}
          />
        </Field>
      </div>

      <Field
        label="Model"
        hint="Pick a suggestion or type any model identifier the endpoint accepts. This field is never restricted to the list."
      >
        <div className="grid gap-2 sm:grid-cols-[1fr_1fr]">
          <Select
            value={provider?.suggestedModels.some((m) => m.id === model) ? model : ''}
            onChange={(e) => pickSuggested(e.target.value)}
            options={[
              { value: '', label: provider?.suggestedModels.length ? 'Choose a suggested model' : 'No suggestions' },
              ...(provider?.suggestedModels ?? []).map((m) => ({ value: m.id, label: m.label })),
            ]}
          />
          <Input
            value={model}
            onChange={(e) => setModel(e.target.value)}
            placeholder="model identifier"
            aria-label="Model identifier"
            required
          />
        </div>
      </Field>

      {provider?.baseUrl !== 'none' ? (
        <Field
          label={provider?.baseUrl === 'required' ? 'Base URL' : 'Base URL (optional)'}
          hint={
            provider?.id === 'ollama'
              ? 'Where Ollama is listening, for example http://localhost:11434.'
              : 'The endpoint root. Leave blank to use the provider default.'
          }
        >
          <Input
            type="url"
            value={baseUrl}
            onChange={(e) => setBaseUrl(e.target.value)}
            placeholder="https://your-endpoint.internal/v1"
            required={provider?.baseUrl === 'required'}
          />
        </Field>
      ) : null}

      {provider?.needsApiKey ? (
        <Field
          label="API key"
          hint="Encrypted with AES-256-GCM before it is stored and never returned to a browser again — not even to yours."
          aside={
            provider.keyUrl ? (
              <a
                href={provider.keyUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 text-[11px] text-accent-600 hover:underline dark:text-accent-500"
              >
                Get a key
                <ExternalLink className="h-2.5 w-2.5" aria-hidden />
              </a>
            ) : null
          }
        >
          <div className="relative">
            <KeyRound
              className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-zinc-400"
              aria-hidden
            />
            <Input
              type="password"
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              autoComplete="off"
              spellCheck={false}
              placeholder="sk-..."
              className="pl-8"
            />
          </div>
        </Field>
      ) : (
        <FieldHint>
          This provider does not take an API key. Reachability is the only thing that has to be true.
        </FieldHint>
      )}

      <div className="grid gap-3 sm:grid-cols-3">
        <Field label="Input cost" hint="US dollars per million tokens.">
          <Input
            type="number"
            min={0}
            step="0.01"
            value={inputCost}
            onChange={(e) => setInputCost(e.target.value)}
            placeholder="3.00"
          />
        </Field>
        <Field label="Output cost" hint="US dollars per million tokens.">
          <Input
            type="number"
            min={0}
            step="0.01"
            value={outputCost}
            onChange={(e) => setOutputCost(e.target.value)}
            placeholder="15.00"
          />
        </Field>
        <Field label="Max output tokens" hint="Ceiling for a single completion.">
          <Input
            type="number"
            min={256}
            step={256}
            value={maxOutputTokens}
            onChange={(e) => setMaxOutputTokens(e.target.value)}
          />
        </Field>
      </div>

      <Toggle
        checked={isDefault}
        onChange={setIsDefault}
        label="Use this connection by default"
        description="Briefs, Ask and AI tagging all run through the default connection unless a feature overrides it."
      />

      {error ? <p className="text-[11px] text-red-600 dark:text-red-400">{error}</p> : null}

      <div className="flex items-center gap-2">
        <Button type="submit" variant="primary" size="sm" disabled={saving}>
          {saving ? <Loader2 className="h-3 w-3 animate-spin" aria-hidden /> : null}
          Save connection
        </Button>
        <Button type="button" size="sm" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </form>
  );
}
