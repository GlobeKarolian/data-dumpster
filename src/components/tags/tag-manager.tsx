'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { Loader2, Pencil, Plus, Sparkles, Trash2, Wand2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Card, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Field, Input, Textarea } from '@/components/ui/input';
import { Tabs } from '@/components/ui/tabs';
import { Badge } from '@/components/ui/badge';
import { EmptyState } from '@/components/ui/empty-state';

export interface TagRecord {
  id: string;
  name: string;
  color: string | null;
  rule: {
    anyKeywords?: string[];
    noneKeywords?: string[];
    hashtags?: string[];
    urlDomains?: string[];
  } | null;
  aiPrompt: string | null;
}

const SWATCHES = ['#C8102E', '#2563EB', '#0D9488', '#D97706', '#7C3AED', '#DB2777', '#65A30D', '#0891B2'];

function splitList(value: string): string[] {
  return value.split(',').map((s) => s.trim()).filter(Boolean);
}

/**
 * Tags are how a newsroom asks its own questions of the data: "everything we
 * published about the mayoral race", "every service piece". Two ways to define
 * one, and the choice is deliberate. A keyword rule is deterministic, free, and
 * auditable. A prompt is flexible and runs on the org's own model. Neither is
 * hidden behind the other.
 */
export function TagManager({ tags }: { tags: TagRecord[] }) {
  const router = useRouter();
  const [editing, setEditing] = React.useState<TagRecord | null>(null);
  const [creating, setCreating] = React.useState(false);
  const [busyId, setBusyId] = React.useState<string | null>(null);
  const [error, setError] = React.useState<string | null>(null);

  const remove = async (tag: TagRecord) => {
    setBusyId(tag.id);
    setError(null);
    try {
      const res = await fetch('/api/tags/' + tag.id, { method: 'DELETE' });
      if (!res.ok) throw new Error('Delete failed with status ' + res.status + '.');
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not delete the tag.');
    } finally {
      setBusyId(null);
    }
  };

  return (
    <Card>
      <CardHeader>
        <div>
          <CardTitle>Tag definitions</CardTitle>
          <p className="mt-0.5 text-xs text-zinc-500 dark:text-zinc-400">
            Applied at ingest. Editing a rule affects posts collected from now on.
          </p>
        </div>
        <Button
          size="sm"
          variant="primary"
          onClick={() => {
            setCreating(true);
            setEditing(null);
          }}
        >
          <Plus className="h-3 w-3" aria-hidden />
          New tag
        </Button>
      </CardHeader>

      {error ? (
        <p className="border-b border-red-200 bg-red-50 px-4 py-2 text-xs text-red-700 dark:border-red-900/50 dark:bg-red-950/30 dark:text-red-400">
          {error}
        </p>
      ) : null}

      {creating || editing ? (
        <div className="border-b border-zinc-200 bg-zinc-50 p-4 dark:border-zinc-800 dark:bg-zinc-900/40">
          <TagForm
            tag={editing}
            onDone={() => {
              setCreating(false);
              setEditing(null);
              router.refresh();
            }}
            onCancel={() => {
              setCreating(false);
              setEditing(null);
            }}
          />
        </div>
      ) : null}

      {tags.length === 0 && !creating ? (
        <EmptyState
          compact
          icon={Wand2}
          title="No tags yet"
          description="A tag turns a newsroom question into a filter. Start with one desk or one running story; the rule can be a handful of keywords."
        />
      ) : (
        <ul className="divide-y divide-zinc-100 dark:divide-zinc-800/60">
          {tags.map((tag) => (
            <li key={tag.id} className="flex items-start gap-3 px-4 py-3">
              <span
                aria-hidden
                className="mt-1 h-2.5 w-2.5 shrink-0 rounded-full"
                style={{ backgroundColor: tag.color ?? '#71717a' }}
              />
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-xs font-medium text-zinc-900 dark:text-zinc-100">{tag.name}</span>
                  {tag.aiPrompt ? (
                    <Badge tone="accent">
                      <Sparkles className="h-2.5 w-2.5" aria-hidden />
                      Model
                    </Badge>
                  ) : (
                    <Badge tone="neutral">Rule</Badge>
                  )}
                </div>
                <p className="mt-0.5 truncate text-[11px] leading-relaxed text-zinc-500">
                  {tag.aiPrompt
                    ? tag.aiPrompt
                    : [
                        tag.rule?.anyKeywords?.length ? 'any of: ' + tag.rule.anyKeywords.join(', ') : null,
                        tag.rule?.noneKeywords?.length ? 'none of: ' + tag.rule.noneKeywords.join(', ') : null,
                        tag.rule?.hashtags?.length ? 'hashtags: ' + tag.rule.hashtags.join(', ') : null,
                        tag.rule?.urlDomains?.length ? 'domains: ' + tag.rule.urlDomains.join(', ') : null,
                      ]
                        .filter(Boolean)
                        .join(' · ') || 'No matching criteria set, so this tag matches nothing.'}
                </p>
              </div>
              <div className="flex shrink-0 items-center gap-1">
                <Button
                  size="icon"
                  variant="ghost"
                  aria-label={'Edit ' + tag.name}
                  onClick={() => {
                    setEditing(tag);
                    setCreating(false);
                  }}
                >
                  <Pencil className="h-3.5 w-3.5" aria-hidden />
                </Button>
                <Button
                  size="icon"
                  variant="ghost"
                  aria-label={'Delete ' + tag.name}
                  disabled={busyId === tag.id}
                  onClick={() => remove(tag)}
                >
                  {busyId === tag.id ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
                  ) : (
                    <Trash2 className="h-3.5 w-3.5" aria-hidden />
                  )}
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

function TagForm({
  tag,
  onDone,
  onCancel,
}: {
  tag: TagRecord | null;
  onDone: () => void;
  onCancel: () => void;
}) {
  const [mode, setMode] = React.useState<'rule' | 'ai'>(tag?.aiPrompt ? 'ai' : 'rule');
  const [name, setName] = React.useState(tag?.name ?? '');
  const [color, setColor] = React.useState(tag?.color ?? SWATCHES[0]);
  const [anyKeywords, setAnyKeywords] = React.useState((tag?.rule?.anyKeywords ?? []).join(', '));
  const [noneKeywords, setNoneKeywords] = React.useState((tag?.rule?.noneKeywords ?? []).join(', '));
  const [hashtags, setHashtags] = React.useState((tag?.rule?.hashtags ?? []).join(', '));
  const [urlDomains, setUrlDomains] = React.useState((tag?.rule?.urlDomains ?? []).join(', '));
  const [aiPrompt, setAiPrompt] = React.useState(tag?.aiPrompt ?? '');
  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) {
      setError('A tag needs a name.');
      return;
    }
    setSaving(true);
    setError(null);
    const body = {
      name: name.trim(),
      color,
      rule:
        mode === 'rule'
          ? {
              anyKeywords: splitList(anyKeywords),
              noneKeywords: splitList(noneKeywords),
              hashtags: splitList(hashtags),
              urlDomains: splitList(urlDomains),
            }
          : null,
      aiPrompt: mode === 'ai' ? aiPrompt.trim() : null,
    };
    try {
      const res = await fetch(tag ? '/api/tags/' + tag.id : '/api/tags', {
        method: tag ? 'PATCH' : 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error('Save failed with status ' + res.status + '.');
      onDone();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save the tag.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <form onSubmit={submit} className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-[1fr_auto]">
        <Field label="Tag name" htmlFor="tag-name">
          <Input
            id="tag-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Mayoral race"
            required
          />
        </Field>
        <Field label="Color">
          <div className="flex items-center gap-1.5 pt-1">
            {SWATCHES.map((c) => (
              <button
                key={c}
                type="button"
                aria-label={'Use color ' + c}
                onClick={() => setColor(c)}
                className={cn(
                  'h-5 w-5 rounded-full ring-offset-2 transition-shadow dark:ring-offset-zinc-900',
                  color === c && 'ring-2 ring-zinc-900 dark:ring-zinc-100',
                )}
                style={{ backgroundColor: c }}
              />
            ))}
          </div>
        </Field>
      </div>

      <Tabs
        label="Tagging method"
        value={mode}
        onChange={(id) => setMode(id === 'ai' ? 'ai' : 'rule')}
        items={[
          { id: 'rule', label: 'Keyword rule' },
          { id: 'ai', label: 'Model prompt' },
        ]}
      />

      {mode === 'rule' ? (
        <div className="grid gap-3 sm:grid-cols-2">
          <Field
            label="Match any of these words"
            hint="Comma separated. Case insensitive, matched against caption text."
          >
            <Input value={anyKeywords} onChange={(e) => setAnyKeywords(e.target.value)} placeholder="mayor, city hall, election" />
          </Field>
          <Field label="But not these" hint="Use this to keep obvious false positives out.">
            <Input value={noneKeywords} onChange={(e) => setNoneKeywords(e.target.value)} placeholder="mayoral portrait" />
          </Field>
          <Field label="Hashtags" hint="Without the hash.">
            <Input value={hashtags} onChange={(e) => setHashtags(e.target.value)} placeholder="bospoli, election2026" />
          </Field>
          <Field label="Linked domains" hint="Tag posts that link to these hosts.">
            <Input value={urlDomains} onChange={(e) => setUrlDomains(e.target.value)} placeholder="bostonglobe.com" />
          </Field>
        </div>
      ) : (
        <Field
          label="Describe what belongs in this tag"
          hint="Runs on your configured model at ingest time. Write it the way you would brief a new intern: specific, with an example of what does not count."
        >
          <Textarea
            value={aiPrompt}
            onChange={(e) => setAiPrompt(e.target.value)}
            rows={4}
            placeholder="Posts about the Boston mayoral race, including candidate profiles, debates, polling and endorsements. Not general City Hall coverage unrelated to the campaign."
          />
        </Field>
      )}

      {error ? <p className="text-[11px] text-red-600 dark:text-red-400">{error}</p> : null}

      <div className="flex items-center gap-2">
        <Button type="submit" variant="primary" size="sm" disabled={saving}>
          {saving ? <Loader2 className="h-3 w-3 animate-spin" aria-hidden /> : null}
          {tag ? 'Save changes' : 'Create tag'}
        </Button>
        <Button type="button" size="sm" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </form>
  );
}
