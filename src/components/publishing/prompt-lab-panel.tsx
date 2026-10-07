'use client';

import * as React from 'react';
import { Check, FlaskConical } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { PlatformIcon } from '@/components/ui/platform-icon';
import { cn } from '@/lib/utils';
import { PUBLISH_PLATFORM_LABELS, type PublishPlatform } from '@/lib/publishing/platforms';
import type { LabResult } from '@/lib/publishing/prompt-lab';
import type { ModelFit } from '@/lib/publishing/prompt-lab-model';
import { api } from './api';

/**
 * "Learn from our posts": runs the Prompt Lab over the landscapes an admin
 * picks and offers a suggested instruction per network, with the measurements
 * behind it. Keeping a suggestion only fills the box; Save still decides.
 */

interface Landscape { id: string; name: string }

const DEFAULT_LANDSCAPES = [/^BGM$/i, /boston news landscape/i];

export function PromptLabPanel({ current, onUse }: {
  current: Record<PublishPlatform, string>;
  onUse: (platform: PublishPlatform, prompt: string) => void;
}) {
  const [landscapes, setLandscapes] = React.useState<Landscape[] | null>(null);
  const [picked, setPicked] = React.useState<string[]>([]);
  const [days, setDays] = React.useState<90 | 180 | 365>(180);
  const [running, setRunning] = React.useState(false);
  const [results, setResults] = React.useState<LabResult[] | null>(null);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    void Promise.resolve().then(async () => {
      try {
        const r = await api<{ items: Landscape[] }>('/api/landscapes');
        const items = r.items.map((l) => ({ id: l.id, name: l.name }));
        setLandscapes(items);
        const defaults = items.filter((l) => DEFAULT_LANDSCAPES.some((re) => re.test(l.name))).map((l) => l.id);
        setPicked(defaults.length ? defaults : items.slice(0, 1).map((l) => l.id));
      } catch (e) { setError((e as Error).message); }
    });
  }, []);

  const run = async () => {
    setRunning(true); setError(null); setResults(null);
    try {
      const r = await api<{ results: LabResult[] }>('/api/publishing/draft/learn', { method: 'POST', json: { landscapeIds: picked, days } });
      setResults(r.results);
    } catch (e) { setError((e as Error).message); } finally { setRunning(false); }
  };

  const usable = (results ?? []).filter((r) => r.suggestion);
  const cost = (results ?? []).reduce((s, r) => s + (r.costUsd ?? 0), 0);

  return (
    <div className="space-y-3 rounded-lg border border-violet-200 bg-violet-50/40 p-4 dark:border-violet-900 dark:bg-violet-950/20">
      <div className="flex items-start gap-2">
        <FlaskConical className="mt-0.5 h-4 w-4 shrink-0 text-violet-600" />
        <div className="space-y-1">
          <p className="text-sm font-semibold">Learn from posts that worked</p>
          <p className="text-xs leading-relaxed text-zinc-600 dark:text-zinc-400">
            Compares the top 10% of posts on each network with typical ones, from the landscapes you pick, and suggests new instructions. Each post is scored against its own account&apos;s typical post, so big accounts don&apos;t drown out small ones. A statistical model then holds topic, format and timing fixed, and compares posts of the same story, to separate what the wording adds from what the news itself did. It measures reactions, comments and shares, not clicks, and it never overrides the house rules.
          </p>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-1.5">
        {landscapes === null ? <span className="text-xs text-zinc-400">Loading landscapes…</span> : landscapes.map((l) => {
          const on = picked.includes(l.id);
          return (
            <button key={l.id} type="button" aria-pressed={on} onClick={() => setPicked(on ? picked.filter((x) => x !== l.id) : [...picked, l.id].slice(-6))}
              className={cn('h-7 rounded-full border px-2.5 text-xs transition', on
                ? 'border-violet-600 bg-violet-600 text-white'
                : 'border-zinc-200 bg-white text-zinc-600 hover:border-zinc-400 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-300')}>
              {l.name}
            </button>
          );
        })}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <select value={days} onChange={(e) => setDays(Number(e.target.value) as 90 | 180 | 365)} aria-label="Window"
          className="h-8 rounded-md border border-zinc-200 bg-white px-2 text-sm dark:border-zinc-700 dark:bg-zinc-900">
          <option value={90}>Last 90 days</option>
          <option value={180}>Last 180 days</option>
          <option value={365}>Last year</option>
        </select>
        <Button size="sm" variant="primary" disabled={running || !picked.length} onClick={run}>
          {running ? 'Studying posts… (about a minute)' : results ? 'Run again' : 'Study our posts'}
        </Button>
        {usable.length > 1 ? (
          <Button size="sm" variant="secondary" onClick={() => usable.forEach((r) => onUse(r.platform, r.suggestion!.prompt))}>Use all {usable.length} suggestions</Button>
        ) : null}
        {results && cost > 0 ? <span className="text-[11px] text-zinc-500">Model cost ${cost.toFixed(2)}</span> : null}
      </div>
      {error ? <p className="text-sm text-red-600">{error}</p> : null}

      {results ? (
        <div className="space-y-3">
          {results.map((r) => <LabCard key={r.platform} r={r} inUse={!!r.suggestion && current[r.platform].trim() === r.suggestion.prompt.trim()} onUse={onUse} />)}
          {usable.length ? <p className="text-[11px] text-zinc-500">Keeping a suggestion fills that network&apos;s box below. Nothing changes until you press Save instructions.</p> : null}
        </div>
      ) : null}
    </div>
  );
}

function LabCard({ r, inUse, onUse }: { r: LabResult; inUse: boolean; onUse: (p: PublishPlatform, prompt: string) => void }) {
  const [showExamples, setShowExamples] = React.useState(false);
  const f = r.facts;
  // The patterns where top and typical posts differ most.
  const gaps = (f?.features ?? []).map((x) => ({ ...x, gap: x.topPct - x.typicalPct }))
    .sort((a, b) => Math.abs(b.gap) - Math.abs(a.gap)).slice(0, 5);

  return (
    <div className="rounded-lg border border-zinc-200 bg-white p-3 dark:border-zinc-800 dark:bg-zinc-900">
      <div className="flex flex-wrap items-center gap-2">
        <PlatformIcon platform={r.platform} className="h-4 w-4" />
        <span className="text-sm font-semibold">{PUBLISH_PLATFORM_LABELS[r.platform]}</span>
        {f ? <span className="pb-num text-[11px] text-zinc-500">{f.posts.toLocaleString()} posts from {f.accounts} accounts · top posts did at least {f.topLiftFloor}x their account&apos;s typical engagement</span> : null}
        {r.suggestion ? (
          <Button size="sm" variant={inUse ? 'ghost' : 'secondary'} className="ml-auto" disabled={inUse} onClick={() => onUse(r.platform, r.suggestion!.prompt)}>
            {inUse ? <><Check className="h-3.5 w-3.5" />In the box below</> : 'Use this'}
          </Button>
        ) : null}
      </div>

      {r.skipped ? <p className="mt-2 text-xs text-amber-800 dark:text-amber-300">{r.skipped}</p> : null}

      {r.suggestion ? (
        <>
          <p className="mt-2 rounded-md bg-zinc-50 p-2.5 text-[13px] leading-relaxed text-zinc-800 dark:bg-zinc-800/60 dark:text-zinc-100">{r.suggestion.prompt}</p>
          {r.suggestion.reasons.length ? (
            <ul className="mt-2 space-y-1 text-xs text-zinc-600 dark:text-zinc-300">
              {r.suggestion.reasons.map((x, i) => <li key={i}><span className="font-medium text-zinc-800 dark:text-zinc-100">{x.rule}</span> {x.evidence}</li>)}
            </ul>
          ) : null}
          {r.droppedReasons ? <p className="mt-1 text-[11px] text-zinc-400">{r.droppedReasons} reason{r.droppedReasons === 1 ? ' was' : 's were'} removed because {r.droppedReasons === 1 ? 'its numbers' : 'their numbers'} did not match the measurements.</p> : null}
        </>
      ) : null}

      {f ? (
        <div className="mt-2 grid gap-x-6 gap-y-0.5 text-[11px] text-zinc-500 sm:grid-cols-2">
          <span className="pb-num">Median length: top {f.medianLength.top} · typical {f.medianLength.typical} characters</span>
          {gaps.map((g) => (
            <span key={g.key} className="pb-num">
              {g.label}: top {g.topPct}% · typical {g.typicalPct}%
            </span>
          ))}
        </div>
      ) : null}

      {r.model?.controlled ? (
        <Effects title={`With ${r.model.controls.join(', ') || 'other factors'} held fixed`} fit={r.model.controlled} />
      ) : null}
      {r.model?.sameStory ? (
        <Effects title={`Same story, different wording (${r.model.sameStory.stories.toLocaleString()} stories posted more than once)`} fit={r.model.sameStory} />
      ) : null}

      {r.examples?.length ? (
        <div className="mt-2">
          <button type="button" className="text-[11px] text-accent-700 hover:underline dark:text-accent-400" onClick={() => setShowExamples(!showExamples)}>
            {showExamples ? 'Hide top posts' : 'Show top posts'}
          </button>
          {showExamples ? (
            <ul className="mt-1 space-y-1.5">
              {r.examples.map((e, i) => (
                <li key={i} className="rounded border border-zinc-100 p-2 text-[12px] leading-snug dark:border-zinc-800">
                  <span className="pb-num font-medium text-zinc-500">{e.company} · {e.lift}x typical</span>
                  <span className="mt-0.5 block whitespace-pre-line text-zinc-700 dark:text-zinc-200">{e.text}</span>
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

/** What the regression found: each wording trait's effect on lift, with its 90% range. */
function Effects({ title, fit }: { title: string; fit: ModelFit }) {
  const shown = fit.effects.slice(0, 6);
  const signed = (n: number) => (n > 0 ? `+${n}%` : `${n}%`);
  return (
    <div className="mt-2 rounded-md border border-zinc-100 p-2 dark:border-zinc-800">
      <p className="text-[11px] font-medium text-zinc-600 dark:text-zinc-300">
        {title}
        <span className="font-normal text-zinc-400">
          {' '}· {fit.posts.toLocaleString()} posts{fit.holdoutRank !== null ? ` · prediction check ${fit.holdoutRank} (0 is no signal)` : ''}
        </span>
      </p>
      <ul className="mt-1 grid gap-x-6 gap-y-0.5 sm:grid-cols-2">
        {shown.map((e) => (
          <li key={e.key} className={cn('pb-num text-[11px]', !e.clear ? 'text-zinc-400'
            : e.effectPct > 0 ? 'text-emerald-700 dark:text-emerald-400' : 'text-red-700 dark:text-red-400')}>
            {e.label}: {signed(e.effectPct)} <span className="text-zinc-400">({signed(e.lowPct)} to {signed(e.highPct)}{e.clear ? '' : ', unclear'})</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
