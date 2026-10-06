'use client';

import * as React from 'react';
import { api, type Post, type Target } from './api';
import { usePublish } from './shell';

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
  const { version } = usePublish();
  React.useEffect(() => {
    void Promise.resolve().then(load);
    const id = setInterval(load, 30_000);
    return () => clearInterval(id);
  }, [load, version]);
  return { targets, posts, canApprove, error, reload: load };
}

