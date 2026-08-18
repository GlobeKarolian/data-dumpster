'use client';

/**
 * Mission control for the tagging pipeline.
 *
 * Polls /api/tags/activity every four seconds and animates what actually
 * happened: posts slide in as they settle, their tags stamp on a beat later,
 * counters count up to the real totals. The fun is presentation only — every
 * card is a settled row, every number a database count. Nothing is simulated,
 * because a delightful lie about a data pipeline is still a lie.
 */
import * as React from 'react';
import Link from 'next/link';
import { Radio } from 'lucide-react';

interface FeedTag { id: string; name: string; color: string | null; confidence: number | null }
interface FeedItem {
  id: string; at: string; company: string; platform: string;
  text: string | null; tags: FeedTag[];
}
interface Totals { postsRead: number; tagsApplied: number; spendUsd: number; lastHour: number }

const PLATFORM_GLYPH: Record<string, string> = {
  facebook: 'f', instagram: '◎', twitter: '𝕏', youtube: '▶', tiktok: '♪',
  linkedin: 'in', bluesky: '🦋', threads: '@', reddit: '◉', truth_social: 'T',
};

function useCountUp(target: number, ms = 900): number {
  const [value, setValue] = React.useState(target);
  const fromRef = React.useRef(target);
  React.useEffect(() => {
    const from = fromRef.current;
    if (from === target) return;
    const start = performance.now();
    let raf = 0;
    const step = (now: number) => {
      const t = Math.min(1, (now - start) / ms);
      const eased = 1 - (1 - t) ** 3;
      setValue(Math.round(from + (target - from) * eased));
      if (t < 1) raf = requestAnimationFrame(step);
      else fromRef.current = target;
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [target, ms]);
  return value;
}

function Counter({ label, value, prefix = '' }: { label: string; value: number; prefix?: string }) {
  const shown = useCountUp(value);
  return (
    <div className="text-center">
      <p className="pb-num text-3xl font-bold tabular-nums text-zinc-900 dark:text-zinc-50">
        {prefix}{shown.toLocaleString()}
      </p>
      <p className="mt-1 text-[10px] font-semibold uppercase tracking-widest text-zinc-500">{label}</p>
    </div>
  );
}

function TagChip({ tag, delayMs }: { tag: FeedTag; delayMs: number }) {
  const [stamped, setStamped] = React.useState(false);
  React.useEffect(() => {
    const timer = setTimeout(() => setStamped(true), delayMs);
    return () => clearTimeout(timer);
  }, [delayMs]);
  return (
    <Link
      href={`/posts?tags=${tag.id}`}
      prefetch={false}
      title={`All posts tagged “${tag.name}”`}
      className="inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-semibold transition-all duration-300 hover:opacity-70"
      style={{
        borderColor: tag.color ?? '#71717a',
        color: tag.color ?? '#71717a',
        opacity: stamped ? 1 : 0,
        transform: stamped ? 'scale(1)' : 'scale(1.6)',
      }}
    >
      {tag.name}
      {tag.confidence !== null ? (
        <span className="pb-num opacity-60">{Math.round(tag.confidence * 100)}%</span>
      ) : null}
    </Link>
  );
}

function FeedCard({ item, fresh }: { item: FeedItem; fresh: boolean }) {
  const [entered, setEntered] = React.useState(!fresh);
  React.useEffect(() => {
    if (fresh) {
      const raf = requestAnimationFrame(() => setEntered(true));
      return () => cancelAnimationFrame(raf);
    }
  }, [fresh]);
  return (
    <div
      className="rounded-lg border border-zinc-200 bg-white p-3 shadow-sm transition-all duration-500 dark:border-zinc-800 dark:bg-zinc-900/60"
      style={{
        opacity: entered ? 1 : 0,
        transform: entered ? 'translateY(0)' : 'translateY(-14px)',
      }}
    >
      <div className="flex items-center gap-2 text-xs">
        <span className="flex h-5 w-5 items-center justify-center rounded bg-zinc-100 font-bold text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300">
          {PLATFORM_GLYPH[item.platform] ?? '·'}
        </span>
        <span className="font-semibold text-zinc-900 dark:text-zinc-100">{item.company}</span>
        <span className="text-zinc-400">{new Date(item.at).toLocaleTimeString()}</span>
      </div>
      {item.text ? (
        <p className="mt-1.5 line-clamp-2 text-xs leading-relaxed text-zinc-600 dark:text-zinc-400">
          {item.text}
        </p>
      ) : null}
      <div className="mt-2 flex min-h-6 flex-wrap gap-1.5">
        {item.tags.length > 0 ? (
          item.tags.map((tag, i) => (
            <TagChip key={tag.name} tag={tag} delayMs={fresh ? 350 + i * 180 : 0} />
          ))
        ) : (
          <span className="text-[11px] italic text-zinc-400">read — no tags apply</span>
        )}
      </div>
    </div>
  );
}

export function TaggingLiveFeed({ initial }: {
  initial: { totals: Totals; recent: FeedItem[] };
}) {
  // Seeded from the server render: the first paint is already true, and a
  // session where this component's effects never run still shows real data.
  // Freshness is computed when a poll lands (never during render) and stored
  // alongside each item, so render is a pure read of state.
  const [items, setItems] = React.useState<{ item: FeedItem; fresh: boolean }[]>(
    initial.recent.map((item) => ({ item, fresh: false })),
  );
  const [totals, setTotals] = React.useState<Totals>(initial.totals);
  const [error, setError] = React.useState<string | null>(null);
  const seenRef = React.useRef<Set<string>>(new Set(initial.recent.map((r) => r.id)));

  React.useEffect(() => {
    let alive = true;
    const poll = async () => {
      try {
        const res = await fetch('/api/tags/activity', { cache: 'no-store' });
        if (!res.ok) throw new Error(`activity ${res.status}`);
        const body = await res.json() as { totals: Totals; recent: FeedItem[] };
        if (!alive) return;
        const known = seenRef.current;
        const next = body.recent.map((item) => {
          const fresh = !known.has(item.id);
          if (fresh) known.add(item.id);
          return { item, fresh };
        });
        setTotals(body.totals);
        setError(null);
        setItems(next);
      } catch (e) {
        if (alive) setError(e instanceof Error ? e.message : 'unreachable');
      }
    };
    void poll();
    const timer = setInterval(poll, 4000);
    return () => { alive = false; clearInterval(timer); };
  }, []);

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <span className="relative flex h-2.5 w-2.5">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-red-500 opacity-60" />
            <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-red-500" />
          </span>
          <h1 className="text-lg font-bold text-zinc-900 dark:text-zinc-50">Tagging, live</h1>
          <Radio className="h-4 w-4 text-zinc-400" aria-hidden />
        </div>
        <p className="text-xs text-zinc-500">
          Every card is a real read; every number is a database count. Updates every few seconds.
        </p>
      </div>

      <div className="grid grid-cols-2 gap-4 rounded-xl border border-zinc-200 bg-white px-4 py-5 sm:grid-cols-4 dark:border-zinc-800 dark:bg-zinc-900/40">
        <Counter label="Posts read" value={totals.postsRead} />
        <Counter label="Tags applied" value={totals.tagsApplied} />
        <Counter label="Read last hour" value={totals.lastHour} />
        <Counter label="Spend today ¢" value={Math.round(totals.spendUsd * 100)} />
      </div>

      {error ? (
        <p className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900 dark:border-amber-900/50 dark:bg-amber-950/30 dark:text-amber-300">
          Feed paused: {error}. Retrying automatically.
        </p>
      ) : null}

      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {items.map(({ item, fresh }) => (
          <FeedCard key={item.id} item={item} fresh={fresh} />
        ))}
        {items.length === 0 && !error ? (
          <p className="col-span-full py-16 text-center text-sm text-zinc-500">
            Nothing settled in the last two hours. The cron reads every ten minutes; backfills stream continuously.
          </p>
        ) : null}
      </div>
    </div>
  );
}
