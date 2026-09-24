'use client';

import * as React from 'react';
import { ExternalLink, Search } from 'lucide-react';
import { Card, CardBody, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { formatDateTime } from '@/components/ui/format';
import { compactNumber } from '@/lib/utils';
import type { ShareGroup, SharePost, ShareSummary } from '@/lib/leakage/story-shares';

interface Account {
  username: string;
  name: string | null;
  followers: number;
  posts: number;
  leaked: number;
  linked: number;
  automated: boolean;
  accountCreated: string | null;
  verified: string | null;
  bio: string;
}

interface Result {
  story: string;
  window: string;
  queries: Array<{ id: string; label: string; query: string; totalLast7Days: number | null; read: number }>;
  summary: ShareSummary & { capped: boolean };
  accounts: Account[];
  posts: SharePost[];
}

const LINK_LABEL: Record<SharePost['link'], string> = {
  direct: 'Linked the story',
  bypass: 'Leaked copy',
  none: 'No link',
};

const PLACEMENT_LABEL: Record<SharePost['placement'], string> = {
  original: 'Post',
  reply: 'Reply',
  quote: 'Quote',
  retweet: 'Repost',
};

function n(value: number): string {
  return value >= 10_000 ? compactNumber(value) : value.toLocaleString('en-US');
}

function Tile({ label, value, note }: { label: string; value: string; note?: string }) {
  return (
    <div className="rounded-lg border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900/40">
      <p className="text-[11px] font-semibold uppercase tracking-wide text-zinc-500">{label}</p>
      <p className="mt-1 text-2xl font-semibold tabular-nums text-zinc-900 dark:text-zinc-50">{value}</p>
      {note ? <p className="mt-1 text-xs text-zinc-500">{note}</p> : null}
    </div>
  );
}

function Pill({ tone, children }: { tone: 'red' | 'zinc' | 'blue'; children: React.ReactNode }) {
  const tones = {
    red: 'bg-red-50 text-red-700 dark:bg-red-950/40 dark:text-red-300',
    zinc: 'bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300',
    blue: 'bg-blue-50 text-blue-700 dark:bg-blue-950/40 dark:text-blue-300',
  };
  return <span className={'inline-flex items-center rounded px-1.5 py-0.5 text-[11px] font-medium ' + tones[tone]}>{children}</span>;
}

function PostList({ posts, empty }: { posts: SharePost[]; empty: string }) {
  if (posts.length === 0) return <p className="px-4 py-6 text-sm text-zinc-500">{empty}</p>;
  return (
    <ul className="divide-y divide-zinc-100 dark:divide-zinc-800">
      {posts.map((post) => (
        <li key={post.url} className="flex gap-3 px-4 py-3">
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <a href={'https://x.com/' + post.author} target="_blank" rel="noreferrer" className="font-medium text-zinc-900 hover:underline dark:text-zinc-100">
                @{post.author}
              </a>
              <span className="text-xs text-zinc-500">{n(post.followers)} followers</span>
              <Pill tone={post.link === 'bypass' ? 'red' : post.link === 'direct' ? 'blue' : 'zinc'}>
                {post.link === 'bypass' && post.tool ? post.tool : LINK_LABEL[post.link]}
              </Pill>
              <Pill tone="zinc">{PLACEMENT_LABEL[post.placement]}</Pill>
              <span className="text-xs text-zinc-400">{formatDateTime(post.createdAt)}</span>
            </div>
            <p className="mt-1 line-clamp-2 text-sm text-zinc-600 dark:text-zinc-400">{post.text}</p>
          </div>
          <div className="shrink-0 text-right">
            <p className="text-sm font-semibold tabular-nums text-zinc-900 dark:text-zinc-100">{n(post.views)}</p>
            <p className="text-[11px] text-zinc-500">views · {n(post.likes)} likes</p>
            <a href={post.url} target="_blank" rel="noreferrer" className="mt-1 inline-flex items-center gap-1 text-xs text-accent-600 hover:underline">
              Open <ExternalLink className="h-3 w-3" aria-hidden />
            </a>
          </div>
        </li>
      ))}
    </ul>
  );
}

function GroupRow({ label, group, note }: { label: string; group: ShareGroup; note?: string }) {
  return (
    <tr className="border-t border-zinc-100 dark:border-zinc-800">
      <td className="px-4 py-2.5 text-sm text-zinc-900 dark:text-zinc-100">
        {label}
        {note ? <span className="block text-xs text-zinc-500">{note}</span> : null}
      </td>
      <td className="px-4 py-2.5 text-right text-sm tabular-nums">{n(group.posts)}</td>
      <td className="px-4 py-2.5 text-right text-sm tabular-nums">{n(group.accounts)}</td>
      <td className="px-4 py-2.5 text-right text-sm tabular-nums">{n(group.views)}</td>
      <td className="px-4 py-2.5 text-right text-sm tabular-nums">{n(group.medianFollowers)}</td>
    </tr>
  );
}

export function LeakageTool({ initialUrl, initialTerms }: { initialUrl: string; initialTerms: string }) {
  const [url, setUrl] = React.useState(initialUrl);
  const [terms, setTerms] = React.useState(initialTerms);
  const [mentions, setMentions] = React.useState(true);
  const [state, setState] = React.useState<
    { status: 'idle' } | { status: 'loading' } | { status: 'error'; message: string } | { status: 'done'; result: Result }
  >({ status: 'idle' });

  const run = React.useCallback(async (storyUrl: string, storyTerms: string, withMentions: boolean) => {
    if (!storyUrl.trim()) return;
    setState({ status: 'loading' });
    const next = new URLSearchParams({ url: storyUrl.trim() });
    if (storyTerms.trim()) next.set('terms', storyTerms.trim());
    window.history.replaceState(null, '', '/leakage?' + next.toString());
    const api = new URLSearchParams(next);
    api.set('read', withMentions ? 'direct,slug,bypass,mentions' : 'direct,slug,bypass');
    api.set('maxPosts', '300');
    try {
      const response = await fetch('/api/leakage/story?' + api.toString(), { cache: 'no-store' });
      const body = await response.json().catch(() => null);
      if (!response.ok) {
        const message = (body && (body.error?.message ?? body.message)) || 'The search failed (' + response.status + ').';
        setState({ status: 'error', message: response.status === 403 ? 'Only admins can run this, because each search spends X API credits.' : message });
        return;
      }
      setState({ status: 'done', result: body as Result });
    } catch {
      setState({ status: 'error', message: 'Could not reach Data Dumpster. Check your connection and try again.' });
    }
  }, []);

  const ranOnLoad = React.useRef(false);
  React.useEffect(() => {
    if (ranOnLoad.current || !initialUrl) return;
    ranOnLoad.current = true;
    void run(initialUrl, initialTerms, true);
  }, [initialUrl, initialTerms, run]);

  const result = state.status === 'done' ? state.result : null;
  const s = result?.summary;
  const people = result ? result.posts.filter((p) => !result.accounts.find((a) => a.username === p.author)?.automated) : [];
  const byViews = (list: SharePost[]) => [...list].sort((a, b) => b.views - a.views);

  return (
    <div className="mx-auto max-w-6xl space-y-5">
      <div>
        <h1 className="text-lg font-semibold text-zinc-900 dark:text-zinc-50">Article Leakage</h1>
        <p className="mt-1 max-w-3xl text-sm text-zinc-600 dark:text-zinc-400">
          Who is sharing one of our stories on X in the last seven days, and how: linking it, talking about it without a link,
          or passing around an archive or paywall-bypass copy.
        </p>
      </div>

      <Card>
        <CardBody>
          <form
            className="grid gap-3 md:grid-cols-[minmax(0,2fr)_minmax(0,1fr)_auto] md:items-end"
            onSubmit={(event) => { event.preventDefault(); void run(url, terms, mentions); }}
          >
            <label className="block text-sm">
              <span className="mb-1 block text-xs font-medium text-zinc-600 dark:text-zinc-400">Story link</span>
              <Input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://www.bostonglobe.com/2026/09/22/..." inputMode="url" />
            </label>
            <label className="block text-sm">
              <span className="mb-1 block text-xs font-medium text-zinc-600 dark:text-zinc-400">Key words (optional)</span>
              <Input value={terms} onChange={(e) => setTerms(e.target.value)} placeholder="Last Ditch, Greenfield" />
            </label>
            <Button type="submit" variant="primary" disabled={state.status === 'loading' || !url.trim()}>
              <Search className="h-4 w-4" aria-hidden />
              {state.status === 'loading' ? 'Searching X…' : 'Find shares'}
            </Button>
            <label className="flex items-center gap-2 text-xs text-zinc-600 md:col-span-3 dark:text-zinc-400">
              <input type="checkbox" checked={mentions} onChange={(e) => setMentions(e.target.checked)} />
              Also read posts that name the story without linking it (reads more posts, costs a little more)
            </label>
          </form>
          <p className="mt-3 text-xs text-zinc-500">
            Key words catch archive copies whose links hide the source, and posts with no link. Two or three distinctive words
            from the headline work best. Admins only; each search reads up to 300 posts from your X API credits.
          </p>
        </CardBody>
      </Card>

      {state.status === 'loading' ? (
        <p className="text-sm text-zinc-500">Searching X. This can take up to a minute for a widely shared story.</p>
      ) : null}
      {state.status === 'error' ? (
        <p className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300">{state.message}</p>
      ) : null}

      {result && s ? (
        <>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Tile label="People sharing" value={n(s.people)} note={n(s.posts) + ' posts · ' + n(s.reposts) + ' reposts'} />
            <Tile label="Views" value={n(s.views)} note="X impressions on those posts" />
            <Tile
              label="Leaked copies"
              value={n(s.leaked.posts)}
              note={s.leakShareOfLinks === null ? 'No posts linked the story' : Math.round(s.leakShareOfLinks * 100) + '% of posts that linked it'}
            />
            <Tile label="Shared with no link" value={n(s.unlinked.posts)} note={n(s.unlinked.views) + ' views that send no readers'} />
          </div>

          <Card>
            <CardHeader>
              <CardTitle>How they shared it</CardTitle>
              <CardDescription>
                {result.story} · {result.window}
                {s.automatedPosts > 0 ? ' · ' + s.automatedPosts + ' automated replies (Grok) left out' : ''}
                {s.capped ? ' · stopped at 300 posts, so totals are a floor' : ''}
              </CardDescription>
            </CardHeader>
            <div className="relative overflow-x-auto">
              <table className="w-full min-w-[36rem] text-left">
                <thead>
                  <tr className="text-[11px] uppercase tracking-wide text-zinc-500">
                    <th className="px-4 py-2 font-semibold">How</th>
                    <th className="px-4 py-2 text-right font-semibold">Posts</th>
                    <th className="px-4 py-2 text-right font-semibold">Accounts</th>
                    <th className="px-4 py-2 text-right font-semibold">Views</th>
                    <th className="px-4 py-2 text-right font-semibold">Median followers</th>
                  </tr>
                </thead>
                <tbody>
                  <GroupRow label="Linked the story" group={s.linked} />
                  <GroupRow label="Talked about it with no link" group={s.unlinked} />
                  <GroupRow
                    label="Shared an archive or paywall-bypass copy"
                    group={s.leaked}
                    note={s.leaked.posts > 0 ? s.leaked.asReplies + ' of ' + s.leaked.posts + ' were replies · ' + Object.entries(s.leaked.tools).sort((a, b) => b[1] - a[1]).map(([tool, count]) => tool + ' ' + count).join(', ') : undefined}
                  />
                </tbody>
              </table>
            </div>
          </Card>

          <div className="grid gap-5 lg:grid-cols-2">
            <Card className="min-w-0">
              <CardHeader>
                <CardTitle>Biggest reach</CardTitle>
                <CardDescription>The posts that put the story in front of the most people.</CardDescription>
              </CardHeader>
              <PostList posts={byViews(people).slice(0, 10)} empty="No posts found." />
            </Card>
            <Card className="min-w-0">
              <CardHeader>
                <CardTitle>Leaked copies</CardTitle>
                <CardDescription>Archive and paywall-bypass links to this story, most-seen first.</CardDescription>
              </CardHeader>
              <PostList posts={byViews(people.filter((p) => p.link === 'bypass'))} empty="No archive or bypass copies found." />
            </Card>
          </div>

          <Card>
            <CardHeader>
              <CardTitle>Talked about it without linking</CardTitle>
              <CardDescription>Attention the story earned that sends no readers back. Outlets retelling it show up here.</CardDescription>
            </CardHeader>
            <PostList posts={byViews(people.filter((p) => p.link === 'none')).slice(0, 10)} empty="Every post found carried a link." />
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Everyone who shared it</CardTitle>
              <CardDescription>{n(result.accounts.filter((a) => !a.automated).length)} accounts, largest first. Public profile details only.</CardDescription>
            </CardHeader>
            <div className="relative max-h-[32rem] overflow-auto">
              <table className="w-full min-w-[48rem] text-left text-sm">
                <thead className="sticky top-0 bg-white dark:bg-zinc-900">
                  <tr className="text-[11px] uppercase tracking-wide text-zinc-500">
                    <th className="px-4 py-2 font-semibold">Account</th>
                    <th className="px-4 py-2 text-right font-semibold">Followers</th>
                    <th className="px-4 py-2 text-right font-semibold">Posts</th>
                    <th className="px-4 py-2 font-semibold">How</th>
                    <th className="px-4 py-2 font-semibold">On X since</th>
                    <th className="px-4 py-2 font-semibold">Bio</th>
                  </tr>
                </thead>
                <tbody>
                  {result.accounts.filter((a) => !a.automated).map((account) => (
                    <tr key={account.username} className="border-t border-zinc-100 align-top dark:border-zinc-800">
                      <td className="px-4 py-2">
                        <a href={'https://x.com/' + account.username} target="_blank" rel="noreferrer" className="font-medium text-zinc-900 hover:underline dark:text-zinc-100">
                          @{account.username}
                        </a>
                        {account.name ? <span className="block text-xs text-zinc-500">{account.name}</span> : null}
                      </td>
                      <td className="px-4 py-2 text-right tabular-nums">{n(account.followers)}</td>
                      <td className="px-4 py-2 text-right tabular-nums">{account.posts}</td>
                      <td className="px-4 py-2">
                        <span className="flex flex-wrap gap-1">
                          {account.linked > 0 ? <Pill tone="blue">Linked</Pill> : null}
                          {account.leaked > 0 ? <Pill tone="red">Leaked</Pill> : null}
                          {account.linked === 0 && account.leaked === 0 ? <Pill tone="zinc">No link</Pill> : null}
                        </span>
                      </td>
                      <td className="px-4 py-2 text-xs text-zinc-500">{account.accountCreated ? account.accountCreated.slice(0, 4) : ''}</td>
                      <td className="px-4 py-2 text-xs text-zinc-500">{account.bio}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>

          <details className="text-xs text-zinc-500">
            <summary className="cursor-pointer">Searches behind these numbers</summary>
            <ul className="mt-2 space-y-1">
              {result.queries.map((q) => (
                <li key={q.id}>
                  <span className="font-medium text-zinc-700 dark:text-zinc-300">{q.label}:</span>{' '}
                  {q.totalLast7Days === null ? 'count unavailable' : n(q.totalLast7Days) + ' in 7 days'}, {n(q.read)} read · <code>{q.query}</code>
                </li>
              ))}
            </ul>
          </details>
        </>
      ) : null}
    </div>
  );
}
