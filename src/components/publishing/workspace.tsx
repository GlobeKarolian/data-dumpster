'use client';

import * as React from 'react';
import { FlaskConical } from 'lucide-react';
import { api, type Post, type Target } from './api';
import { Composer } from './composer';
import { Queue } from './queue';

export function TestModeBanner({ live }: { live: boolean }) {
  if (live) return null;
  return (
    <div className="flex items-start gap-2 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-200">
      <FlaskConical className="mt-0.5 h-3.5 w-3.5 shrink-0" />
      <span>
        <strong>Test mode.</strong> Nothing is posted to any account. Scheduling, slots, UTMs, approvals, RSS and link in bio all run
        for real; the final send is recorded instead of made. Set <code>PUBLISHING_LIVE=true</code> to go live.
      </span>
    </div>
  );
}

export function usePublishingData(range?: { from: string; to: string }) {
  const [targets, setTargets] = React.useState<Target[] | null>(null);
  const [posts, setPosts] = React.useState<Post[]>([]);
  const [canApprove, setCanApprove] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const from = range?.from;
  const to = range?.to;
  const load = React.useCallback(async () => {
    try {
      const qs = from && to ? `?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}` : '';
      const [t, p] = await Promise.all([
        api<{ targets: Target[] }>('/api/publishing/targets'),
        api<{ posts: Post[]; canApprove: boolean }>('/api/publishing/posts' + qs),
      ]);
      setTargets(t.targets);
      setPosts(p.posts);
      setCanApprove(p.canApprove);
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    }
  }, [from, to]);
  React.useEffect(() => {
    void Promise.resolve().then(load);
    const id = setInterval(load, 30_000);
    return () => clearInterval(id);
  }, [load]);
  return { targets, posts, canApprove, error, reload: load };
}

export function PublishWorkspace({ live, me }: { live: boolean; me: string | null }) {
  const { targets, posts, canApprove, error, reload } = usePublishingData();
  return (
    <div className="space-y-4">
      <TestModeBanner live={live} />
      {error ? <p className="text-sm text-red-600">{error}</p> : null}
      {targets ? <Composer targets={targets} canApprove={canApprove} onCreated={reload} /> : null}
      <Queue posts={posts} canApprove={canApprove} onChange={reload} me={me} />
    </div>
  );
}
