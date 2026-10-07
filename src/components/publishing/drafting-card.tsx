'use client';

import * as React from 'react';
import Link from 'next/link';
import { Sparkles } from 'lucide-react';
import { Card, CardBody, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Field, Input, Textarea } from '@/components/ui/input';
import { PlatformIcon } from '@/components/ui/platform-icon';
import { cn } from '@/lib/utils';
import { PUBLISH_PLATFORMS, PUBLISH_PLATFORM_LABELS, type PublishPlatform } from '@/lib/publishing/platforms';
import { DEFAULT_DRAFT_MODEL, DEFAULT_DRAFT_PROMPTS, DRAFT_MODELS, type DraftPrompts } from '@/lib/publishing/drafting-core';
import { api, fmtWhen } from './api';
import { usePublish } from './shell';
import { PromptLabPanel } from './prompt-lab-panel';

/**
 * Settings for "Draft posts" in the composer: which model writes, and the
 * instructions it follows, house-wide and per network. A field left at the
 * default stays linked to it, so a better default reaches everyone who never
 * changed that field.
 */

interface Loaded {
  model: string;
  prompts: DraftPrompts;
  updatedBy: string | null;
  updatedAt: string | null;
  connection: { ok: boolean; label: string | null; provider: string | null; note: string | null };
}

export function DraftingCard() {
  const { canApprove, toast } = usePublish();
  const [loaded, setLoaded] = React.useState<Loaded | null>(null);
  const [model, setModel] = React.useState('');
  const [house, setHouse] = React.useState('');
  const [platforms, setPlatforms] = React.useState<Record<PublishPlatform, string>>(DEFAULT_DRAFT_PROMPTS.platforms);
  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const apply = React.useCallback((r: Loaded) => {
    setLoaded(r); setModel(r.model); setHouse(r.prompts.house); setPlatforms(r.prompts.platforms);
  }, []);

  React.useEffect(() => {
    void Promise.resolve().then(async () => {
      try { apply(await api<Loaded>('/api/publishing/draft/settings')); } catch (e) { setError((e as Error).message); }
    });
  }, [apply]);

  const dirty = !!loaded && (model !== loaded.model || house !== loaded.prompts.house
    || PUBLISH_PLATFORMS.some((p) => platforms[p] !== loaded.prompts.platforms[p]));

  const save = async () => {
    setSaving(true); setError(null);
    try {
      const same = (a: string, b: string) => a.trim() === b.trim();
      const r = await api<Loaded>('/api/publishing/draft/settings', {
        method: 'PUT',
        json: {
          model: same(model, DEFAULT_DRAFT_MODEL) ? null : model,
          house: same(house, DEFAULT_DRAFT_PROMPTS.house) ? null : house,
          platforms: Object.fromEntries(PUBLISH_PLATFORMS.filter((p) => !same(platforms[p], DEFAULT_DRAFT_PROMPTS.platforms[p])).map((p) => [p, platforms[p]])),
        },
      });
      apply(r);
      toast('Drafting instructions saved.');
    } catch (e) { setError((e as Error).message); } finally { setSaving(false); }
  };

  const reset = (onClick: () => void, changed: boolean) => (canApprove && changed
    ? <button type="button" className="text-[11px] text-accent-700 hover:underline dark:text-accent-400" onClick={onClick}>Reset to default</button>
    : null);

  return (
    <Card>
      <CardHeader>
        <div>
          <CardTitle className="flex items-center gap-1.5"><Sparkles className="h-4 w-4 text-violet-600" />Drafting with AI</CardTitle>
          <CardDescription>
            Paste a story link in the composer and press Draft posts. The tool reads the story and writes a post for each account you picked, following these instructions. Every number and quote is checked against the story, and an editor reviews each post before anything is scheduled.
          </CardDescription>
        </div>
      </CardHeader>
      <CardBody className="space-y-4">
        {!loaded ? <p className="text-sm text-zinc-400">{error ?? 'Loading…'}</p> : (
          <>
            <p className={cn('rounded-md px-3 py-2 text-xs', loaded.connection.ok
              ? 'bg-zinc-50 text-zinc-600 dark:bg-zinc-900 dark:text-zinc-300'
              : 'bg-amber-50 text-amber-900 dark:bg-amber-950/40 dark:text-amber-200')}>
              {loaded.connection.ok
                ? <>Runs on <strong>{loaded.connection.label}</strong>. {loaded.connection.note ?? 'Spend is metered with your other AI use.'}</>
                : <>No model is connected yet. Add an OpenRouter key in <Link href="/settings/models" className="underline">Settings, AI Model</Link>. {loaded.connection.note}</>}
            </p>

            <Field label="Model" htmlFor="draft-model" aside={reset(() => setModel(DEFAULT_DRAFT_MODEL), model.trim() !== DEFAULT_DRAFT_MODEL)}
              hint="An OpenRouter model id. Pick one or type any id from openrouter.ai/models.">
              <Input id="draft-model" list="draft-models" value={model} disabled={!canApprove} onChange={(e) => setModel(e.target.value)} className="max-w-md" />
              <datalist id="draft-models">{DRAFT_MODELS.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}</datalist>
            </Field>

            <Field label="House style (every network)" htmlFor="draft-house" aside={reset(() => setHouse(DEFAULT_DRAFT_PROMPTS.house), house.trim() !== DEFAULT_DRAFT_PROMPTS.house)}>
              <Textarea id="draft-house" rows={8} value={house} disabled={!canApprove} onChange={(e) => setHouse(e.target.value)} className="text-[13px] leading-relaxed" />
            </Field>

            {canApprove ? <PromptLabPanel current={platforms} onUse={(p, prompt) => setPlatforms((prev) => ({ ...prev, [p]: prompt }))} /> : null}

            <div className="space-y-2">
              <p className="text-xs font-medium text-zinc-700 dark:text-zinc-300">Each network</p>
              <div className="grid gap-3 sm:grid-cols-2">
                {PUBLISH_PLATFORMS.map((p) => (
                  <div key={p} className="space-y-1">
                    <div className="flex items-center justify-between">
                      <label htmlFor={`draft-${p}`} className="flex items-center gap-1.5 text-xs font-medium"><PlatformIcon platform={p} className="h-3.5 w-3.5" />{PUBLISH_PLATFORM_LABELS[p]}</label>
                      {reset(() => setPlatforms({ ...platforms, [p]: DEFAULT_DRAFT_PROMPTS.platforms[p] }), platforms[p].trim() !== DEFAULT_DRAFT_PROMPTS.platforms[p])}
                    </div>
                    <Textarea id={`draft-${p}`} rows={4} value={platforms[p]} disabled={!canApprove}
                      onChange={(e) => setPlatforms({ ...platforms, [p]: e.target.value })} className="text-[13px]" />
                  </div>
                ))}
              </div>
            </div>

            {error ? <p className="text-sm text-red-600">{error}</p> : null}
            <div className="flex flex-wrap items-center gap-3">
              {canApprove ? (
                <>
                  <Button variant="primary" disabled={!dirty || saving} onClick={save}>{saving ? 'Saving…' : 'Save instructions'}</Button>
                  {dirty ? <Button variant="ghost" onClick={() => apply(loaded)}>Discard changes</Button> : null}
                </>
              ) : <span className="text-xs text-zinc-500">Only admins can change these.</span>}
              {loaded.updatedAt ? <span className="ml-auto text-[11px] text-zinc-400">Last changed {fmtWhen(loaded.updatedAt)}{loaded.updatedBy ? ` by ${loaded.updatedBy}` : ''}</span> : null}
            </div>
          </>
        )}
      </CardBody>
    </Card>
  );
}
