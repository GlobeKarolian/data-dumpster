'use client';

import * as React from 'react';
import { ExternalLink, Search } from 'lucide-react';
import { Card, CardBody, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { formatDateTime } from '@/components/ui/format';
import { compactNumber } from '@/lib/utils';
import type { ShareGroup, SharePost, ShareSummary } from '@/lib/leakage/story-shares';
import {
  ACCOUNT_TYPE_LABEL, STANCE_LABEL, breakdownByType, type LeakageAnalysis,
} from '@/lib/leakage/analysis';
import type { StoryMeta } from '@/lib/leakage/story-page';
import { CreedBadge, CreedGif, CreedSearching } from './creed';

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
  storyMeta?: StoryMeta | null;
  terms?: string[];
  analysis?: LeakageAnalysis | null;
  runId?: string;
  savedAt?: string;
  storyUrl?: string;
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

function Tile({ label, value, note, adornment }: { label: string; value: string; note?: string; adornment?: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-3 rounded-lg border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900/40">
      <div className="min-w-0">
        <p className="text-[11px] font-semibold uppercase tracking-wide text-zinc-500">{label}</p>
        <p className="mt-1 text-2xl font-semibold tabular-nums text-zinc-900 dark:text-zinc-50">{value}</p>
        {note ? <p className="mt-1 text-xs text-zinc-500">{note}</p> : null}
      </div>
      {adornment}
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

function PostList({ posts, empty, analysis }: { posts: SharePost[]; empty: string; analysis?: LeakageAnalysis | null }) {
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
              {analysis?.accountTypes[post.author] && analysis.accountTypes[post.author] !== 'reader' ? (
                <Pill tone="zinc">{ACCOUNT_TYPE_LABEL[analysis.accountTypes[post.author]]}</Pill>
              ) : null}
              {analysis?.stance[post.url] ? <Pill tone="blue">{STANCE_LABEL[analysis.stance[post.url]]}</Pill> : null}
              {analysis?.workaround[post.url] ? <Pill tone="red">Paywall workaround</Pill> : null}
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


function toCsv(result: Result): string {
  const cols = ['url', 'createdAt', 'author', 'followers', 'placement', 'link', 'tool', 'views', 'likes', 'reposts', 'quotes', 'replies', 'text'] as const;
  const esc = (v: unknown) => {
    const text = v === null || v === undefined ? '' : String(v);
    return /[",\n]/.test(text) ? '"' + text.replace(/"/g, '""') + '"' : text;
  };
  return [cols.join(','), ...result.posts.map((p) => cols.map((c) => esc(p[c])).join(','))].join('\n');
}

function downloadCsv(result: Result) {
  const blob = new Blob([toCsv(result)], { type: 'text/csv;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'leakage-' + result.story.split('/').filter(Boolean).pop() + '-' + (result.savedAt ?? '').slice(0, 10) + '.csv';
  a.click();
  URL.revokeObjectURL(a.href);
}

function useAnalysis(result: Result) {
  const [analysis, setAnalysis] = React.useState<LeakageAnalysis | null>(result.analysis ?? null);
  const [status, setStatus] = React.useState<'idle' | 'loading' | 'error'>(result.analysis ? 'idle' : 'loading');
  const [error, setError] = React.useState<string | null>(null);
  const request = React.useCallback(async (force: boolean) => {
    if (!result.runId) return;
    setStatus('loading');
    try {
      const response = await fetch('/api/leakage/runs/' + result.runId + '/analysis' + (force ? '?force=1' : ''), { method: 'POST' });
      const body = await response.json().catch(() => null);
      if (!response.ok) throw new Error((body && (typeof body.error === 'string' ? body.error : body.error?.message ?? body.message)) || 'Reading the posts failed.');
      setAnalysis(body.analysis as LeakageAnalysis);
      setStatus('idle');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Reading the posts failed.');
      setStatus('error');
    }
  }, [result.runId]);
  const asked = React.useRef(false);
  React.useEffect(() => {
    if (asked.current || result.analysis || !result.runId) return;
    asked.current = true;
    void Promise.resolve().then(() => request(false));
  }, [result.analysis, result.runId, request]);
  return { analysis, status, error, retry: () => request(true) };
}

function RunResults({ result, onRecheck }: { result: Result; onRecheck?: () => void }) {
  const s = result.summary;
  const { analysis, status: analysisStatus, error: analysisError, retry } = useAnalysis(result);
  const people = result.posts.filter((p) => !result.accounts.find((a) => a.username === p.author)?.automated);
  const byViews = (list: SharePost[]) => [...list].sort((a, b) => b.views - a.views);
  return (
    <>
      {result.storyMeta?.headline ? (
        <div>
          <a href={result.storyUrl || 'https://www.' + result.story} target="_blank" rel="noreferrer" className="text-base font-semibold text-zinc-900 hover:underline dark:text-zinc-50">
            {result.storyMeta.headline}
          </a>
          {result.terms && result.terms.length > 0 ? (
            <p className="mt-0.5 text-xs text-zinc-500">Searched X for the link and for “{result.terms.join('” + “')}”.</p>
          ) : null}
        </div>
      ) : null}
      <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-zinc-500">
        <span>
          {result.savedAt ? 'Checked ' + formatDateTime(result.savedAt) + ' · saved, reopening it is free' : ''}
        </span>
        <span className="flex gap-2">
          {onRecheck ? <Button size="sm" onClick={onRecheck}>Check again now</Button> : null}
          <Button size="sm" onClick={() => downloadCsv(result)}>Download CSV</Button>
        </span>
      </div>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Tile label="People sharing" value={n(s.people)} note={n(s.posts) + ' posts · ' + n(s.reposts) + ' reposts'} />
            <Tile label="Views" value={n(s.views)} note="X impressions on those posts" />
            <Tile
              label="Leaked copies"
              value={n(s.leaked.posts)}
              note={s.leakShareOfLinks === null ? 'No posts linked the story' : Math.round(s.leakShareOfLinks * 100) + '% of posts that linked it'}
              adornment={s.leaked.posts > 0 ? <CreedBadge /> : undefined}
            />
            <Tile label="Shared with no link" value={n(s.unlinked.posts)} note={n(s.unlinked.views) + ' views that send no readers'} />
          </div>

          <Card>
            <CardHeader>
              <CardTitle>What stands out</CardTitle>
              <CardDescription>
                {analysisStatus === 'loading'
                  ? 'Reading the posts to work out who is sharing it and why. This takes about half a minute.'
                  : analysis
                    ? 'Written by AI from this run’s posts and numbers' + (analysis.model ? ' (' + analysis.model + ')' : '') + '. Check anything you plan to repeat.'
                    : ''}
              </CardDescription>
            </CardHeader>
            <CardBody>
              {analysisStatus === 'error' ? (
                <p className="text-sm text-red-600">
                  {analysisError} <button type="button" className="underline" onClick={retry}>Try again</button>
                </p>
              ) : null}
              {analysis && analysis.findings.length > 0 ? (
                <ol className="space-y-3">
                  {analysis.findings.map((f, i) => (
                    <li key={i} className="flex gap-3">
                      <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-accent-600 text-[11px] font-semibold text-white">{i + 1}</span>
                      <div>
                        <p className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">{f.headline}</p>
                        <p className="text-sm text-zinc-600 dark:text-zinc-400">{f.detail}</p>
                      </div>
                    </li>
                  ))}
                </ol>
              ) : null}
              {analysis ? (
                <p className="mt-3 text-xs text-zinc-400">
                  <button type="button" className="underline" onClick={retry}>Read the posts again</button>
                </p>
              ) : null}
            </CardBody>
          </Card>

          {analysis ? (
            <Card>
              <CardHeader>
                <CardTitle>Who shared it</CardTitle>
                <CardDescription>Account types are the AI’s read of each profile; every number is counted from the posts.</CardDescription>
              </CardHeader>
              <div className="relative overflow-x-auto">
                <table className="w-full min-w-[40rem] text-left text-sm">
                  <thead>
                    <tr className="text-[11px] uppercase tracking-wide text-zinc-500">
                      <th className="px-4 py-2 font-semibold">Who</th>
                      <th className="px-4 py-2 text-right font-semibold">Accounts</th>
                      <th className="px-4 py-2 text-right font-semibold">Views</th>
                      <th className="px-4 py-2 text-right font-semibold">Linked</th>
                      <th className="px-4 py-2 text-right font-semibold">No link</th>
                      <th className="px-4 py-2 text-right font-semibold">Leaked</th>
                    </tr>
                  </thead>
                  <tbody>
                    {breakdownByType(people, analysis.accountTypes).map((row) => (
                      <tr key={row.type} className="border-t border-zinc-100 dark:border-zinc-800">
                        <td className="px-4 py-2 text-zinc-900 dark:text-zinc-100">{ACCOUNT_TYPE_LABEL[row.type]}</td>
                        <td className="px-4 py-2 text-right tabular-nums">{n(row.accounts)}</td>
                        <td className="px-4 py-2 text-right tabular-nums">{n(row.views)}</td>
                        <td className="px-4 py-2 text-right tabular-nums">{n(row.linked)}</td>
                        <td className="px-4 py-2 text-right tabular-nums">{n(row.unlinked)}</td>
                        <td className="px-4 py-2 text-right tabular-nums">{row.leaked > 0 ? <Pill tone="red">{row.leaked}</Pill> : 0}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {Object.values(analysis.workaround).some(Boolean) ? (
                <p className="px-4 pb-4 text-xs text-zinc-500">
                  {Object.values(analysis.workaround).filter(Boolean).length} of {s.leaked.posts} leaked copies were handed to someone as a way around the paywall.
                </p>
              ) : null}
            </Card>
          ) : null}

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
              <PostList posts={byViews(people).slice(0, 10)} empty="No posts found." analysis={analysis} />
            </Card>
            <Card className="min-w-0">
              <CardHeader>
                <CardTitle>Leaked copies</CardTitle>
                <CardDescription>Archive and paywall-bypass links to this story, most-seen first.</CardDescription>
              </CardHeader>
              <PostList posts={byViews(people.filter((p) => p.link === 'bypass'))} empty="No archive or bypass copies found." analysis={analysis} />
            </Card>
          </div>

          <Card>
            <CardHeader>
              <CardTitle>Talked about it without linking</CardTitle>
              <CardDescription>Attention the story earned that sends no readers back. Outlets retelling it show up here.</CardDescription>
            </CardHeader>
            <PostList posts={byViews(people.filter((p) => p.link === 'none')).slice(0, 10)} empty="Every post found carried a link." analysis={analysis} />
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
                    <th className="px-4 py-2 font-semibold">Type</th>
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
                      <td className="px-4 py-2 text-xs text-zinc-500">{analysis?.accountTypes[account.username] ? ACCOUNT_TYPE_LABEL[analysis.accountTypes[account.username]] : ''}</td>
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
  );
}

type Tab = 'check' | 'history' | 'leakers';

interface RunRow {
  id: string;
  story_key: string;
  story_url: string;
  terms: string[];
  created_at: string;
  people: number;
  views: number;
  leaked: number;
  leak_share: number | null;
  runs_for_story: number;
  headline: string | null;
}

interface LeakerRow {
  author: string;
  stories: number;
  leaks: number;
  views: number;
  followers: number;
  tools: string[];
  last_seen: string | null;
  story_keys: string[];
}

function TabButton({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={
        'border-b-2 px-3 py-2 text-sm font-medium transition-colors '
        + (active ? 'border-accent-600 text-zinc-900 dark:text-zinc-50' : 'border-transparent text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200')
      }
    >
      {children}
    </button>
  );
}

function History({ onOpen, onRecheck }: { onOpen: (id: string) => void; onRecheck: (url: string, terms: string) => void }) {
  const [rows, setRows] = React.useState<RunRow[] | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  React.useEffect(() => {
    fetch('/api/leakage/runs', { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((body: { runs: RunRow[] }) => setRows(body.runs))
      .catch(() => setError('Could not load saved runs.'));
  }, []);
  if (error) return <p className="text-sm text-red-600">{error}</p>;
  if (!rows) return <p className="text-sm text-zinc-500">Loading saved runs…</p>;
  if (rows.length === 0) return <p className="text-sm text-zinc-500">No stories checked yet. Every check is saved here.</p>;
  return (
    <Card>
      <div className="relative overflow-x-auto">
        <table className="w-full min-w-[48rem] text-left text-sm">
          <thead>
            <tr className="text-[11px] uppercase tracking-wide text-zinc-500">
              <th className="px-4 py-2 font-semibold">Story</th>
              <th className="px-4 py-2 font-semibold">Checked</th>
              <th className="px-4 py-2 text-right font-semibold">People</th>
              <th className="px-4 py-2 text-right font-semibold">Views</th>
              <th className="px-4 py-2 text-right font-semibold">Leaked copies</th>
              <th className="px-4 py-2 text-right font-semibold">Leak rate</th>
              <th className="px-4 py-2" />
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.id} className="border-t border-zinc-100 dark:border-zinc-800">
                <td className="max-w-[22rem] px-4 py-2">
                  <a href={row.story_url} target="_blank" rel="noreferrer" className="block truncate font-medium text-zinc-900 hover:underline dark:text-zinc-100">
                    {row.story_key.split('/').filter(Boolean).pop()}
                  </a>
                  <span className="block truncate text-xs text-zinc-500">{row.headline ?? row.story_key}</span>
                </td>
                <td className="px-4 py-2 text-xs text-zinc-500">{formatDateTime(row.created_at)}</td>
                <td className="px-4 py-2 text-right tabular-nums">{n(row.people)}</td>
                <td className="px-4 py-2 text-right tabular-nums">{n(row.views)}</td>
                <td className="px-4 py-2 text-right tabular-nums">{n(row.leaked)}</td>
                <td className="px-4 py-2 text-right tabular-nums">{row.leak_share === null ? '–' : Math.round(row.leak_share * 100) + '%'}</td>
                <td className="whitespace-nowrap px-4 py-2 text-right">
                  <Button size="sm" onClick={() => onOpen(row.id)}>Open</Button>{' '}
                  <Button size="sm" variant="ghost" onClick={() => onRecheck(row.story_url, row.terms.join(', '))}>Check again</Button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

function Leakers() {
  const [rows, setRows] = React.useState<LeakerRow[] | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  React.useEffect(() => {
    fetch('/api/leakage/leakers', { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((body: { leakers: LeakerRow[] }) => setRows(body.leakers))
      .catch(() => setError('Could not load leakers.'));
  }, []);
  if (error) return <p className="text-sm text-red-600">{error}</p>;
  if (!rows) return <p className="text-sm text-zinc-500">Loading…</p>;
  if (rows.length === 0) {
    return (
      <div className="flex items-center gap-4 rounded-lg border border-dashed border-zinc-300 bg-white p-6 dark:border-zinc-700 dark:bg-zinc-900/40">
        <CreedGif size={140} />
        <div>
          <p className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">No repeat offenders yet.</p>
          <p className="mt-1 text-sm text-zinc-500">Check a few stories; accounts that leak more than one show up here.</p>
        </div>
      </div>
    );
  }
  const repeat = rows.filter((r) => r.stories > 1).length;
  return (
    <Card>
      <CardHeader>
        <CardTitle>Accounts sharing leaked copies</CardTitle>
        <CardDescription>
          Across the latest check of every story. {repeat} of {rows.length} accounts leaked more than one story. Public profile details only.
        </CardDescription>
      </CardHeader>
      <div className="relative max-h-[40rem] overflow-auto">
        <table className="w-full min-w-[52rem] text-left text-sm">
          <thead className="sticky top-0 bg-white dark:bg-zinc-900">
            <tr className="text-[11px] uppercase tracking-wide text-zinc-500">
              <th className="px-4 py-2 font-semibold">Account</th>
              <th className="px-4 py-2 text-right font-semibold">Stories leaked</th>
              <th className="px-4 py-2 text-right font-semibold">Leaked posts</th>
              <th className="px-4 py-2 text-right font-semibold">Views</th>
              <th className="px-4 py-2 text-right font-semibold">Followers</th>
              <th className="px-4 py-2 font-semibold">Tools</th>
              <th className="px-4 py-2 font-semibold">Last seen</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.author} className="border-t border-zinc-100 align-top dark:border-zinc-800">
                <td className="px-4 py-2">
                  <a href={'https://x.com/' + row.author} target="_blank" rel="noreferrer" className="font-medium text-zinc-900 hover:underline dark:text-zinc-100">@{row.author}</a>
                  <span className="block max-w-[18rem] truncate text-xs text-zinc-500">{row.story_keys.map((k) => k.split('/').filter(Boolean).pop()).join(', ')}</span>
                </td>
                <td className="px-4 py-2 text-right tabular-nums">{row.stories > 1 ? <Pill tone="red">{row.stories}</Pill> : row.stories}</td>
                <td className="px-4 py-2 text-right tabular-nums">{row.leaks}</td>
                <td className="px-4 py-2 text-right tabular-nums">{n(row.views)}</td>
                <td className="px-4 py-2 text-right tabular-nums">{n(row.followers)}</td>
                <td className="px-4 py-2 text-xs text-zinc-500">{row.tools.join(', ')}</td>
                <td className="px-4 py-2 text-xs text-zinc-500">{formatDateTime(row.last_seen)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

export function LeakageTool({ initialUrl, initialTerms, initialRun }: { initialUrl: string; initialTerms: string; initialRun?: string }) {
  const [tab, setTab] = React.useState<Tab>('check');
  const [url, setUrl] = React.useState(initialUrl);
  const [terms, setTerms] = React.useState(initialTerms);
  const [mentions, setMentions] = React.useState(true);
  const [state, setState] = React.useState<
    { status: 'idle' } | { status: 'loading'; what: string } | { status: 'error'; message: string } | { status: 'done'; result: Result }
  >({ status: 'idle' });

  const load = React.useCallback(async (path: string, what: string) => {
    setState({ status: 'loading', what });
    try {
      const response = await fetch(path, { cache: 'no-store' });
      const body = await response.json().catch(() => null);
      if (!response.ok) {
        const message = (body && (typeof body.error === 'string' ? body.error : body.error?.message ?? body.message)) || 'The request failed (' + response.status + ').';
        setState({ status: 'error', message });
        return;
      }
      const result = body as Result;
      setState({ status: 'done', result });
      if (result.runId) window.history.replaceState(null, '', '/leakage?run=' + result.runId);
      if (result.storyUrl) setUrl(result.storyUrl);
    } catch {
      setState({ status: 'error', message: 'Could not reach Data Dumpster. Check your connection and try again.' });
    }
  }, []);

  const run = React.useCallback((storyUrl: string, storyTerms: string, withMentions: boolean) => {
    if (!storyUrl.trim()) return;
    setTab('check');
    setUrl(storyUrl);
    setTerms(storyTerms);
    const api = new URLSearchParams({ url: storyUrl.trim() });
    if (storyTerms.trim()) api.set('terms', storyTerms.trim());
    api.set('read', withMentions ? 'direct,slug,bypass,mentions' : 'direct,slug,bypass');
    api.set('maxPosts', '300');
    void load('/api/leakage/story?' + api.toString(), 'Searching X. This can take up to a minute for a widely shared story.');
  }, [load]);

  const open = React.useCallback((id: string) => {
    setTab('check');
    void load('/api/leakage/runs/' + encodeURIComponent(id), 'Opening saved run…');
  }, [load]);

  const started = React.useRef(false);
  React.useEffect(() => {
    if (started.current) return;
    started.current = true;
    // Deferred a tick so the effect itself sets no state (react-hooks rule).
    void Promise.resolve().then(() => {
      if (initialRun) open(initialRun);
      else if (initialUrl) run(initialUrl, initialTerms, true);
    });
  }, [initialRun, initialUrl, initialTerms, open, run]);

  const result = state.status === 'done' ? state.result : null;

  return (
    <div className="mx-auto max-w-6xl space-y-5">
      <div>
        <h1 className="text-lg font-semibold text-zinc-900 dark:text-zinc-50">Article Leakage</h1>
        <p className="mt-1 max-w-3xl text-sm text-zinc-600 dark:text-zinc-400">
          Who is sharing our stories on X, and how: linking them, talking about them without a link, or passing around
          archive and paywall-bypass copies. Visible only to you.
        </p>
      </div>

      <div className="flex gap-1 border-b border-zinc-200 dark:border-zinc-800">
        <TabButton active={tab === 'check'} onClick={() => setTab('check')}>Check a story</TabButton>
        <TabButton active={tab === 'history'} onClick={() => setTab('history')}>History</TabButton>
        <TabButton active={tab === 'leakers'} onClick={() => setTab('leakers')}>Repeat leakers</TabButton>
      </div>

      {tab === 'history' ? <History onOpen={open} onRecheck={(u, t) => run(u, t, true)} /> : null}
      {tab === 'leakers' ? <Leakers /> : null}

      {tab === 'check' ? (
        <>
          <Card>
            <CardBody>
              <form
                className="grid gap-3 md:grid-cols-[minmax(0,2fr)_minmax(0,1fr)_auto] md:items-end"
                onSubmit={(event) => { event.preventDefault(); run(url, terms, mentions); }}
              >
                <label className="block text-sm">
                  <span className="mb-1 block text-xs font-medium text-zinc-600 dark:text-zinc-400">Story link</span>
                  <Input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://www.bostonglobe.com/2026/09/22/..." inputMode="url" />
                </label>
                <label className="block text-sm">
                  <span className="mb-1 block text-xs font-medium text-zinc-600 dark:text-zinc-400">Key words (optional)</span>
                  <Input value={terms} onChange={(e) => setTerms(e.target.value)} placeholder="Found automatically from the story" />
                </label>
                <Button type="submit" variant="primary" disabled={state.status === 'loading' || !url.trim()}>
                  <Search className="h-4 w-4" aria-hidden />
                  {state.status === 'loading' ? 'Working…' : 'Find shares'}
                </Button>
                <label className="flex items-center gap-2 text-xs text-zinc-600 md:col-span-3 dark:text-zinc-400">
                  <input type="checkbox" checked={mentions} onChange={(e) => setMentions(e.target.checked)} />
                  Also read posts that name the story without linking it (reads more posts, costs a little more)
                </label>
              </form>
              <p className="mt-3 text-xs text-zinc-500">
                Just paste the link: the story’s own page supplies the names to search for, which catch archive copies whose links
                hide the source and posts with no link. Type key words only to override them. Each check reads up to 300 posts
                from your X API credits, is read by AI for who’s sharing and why, and is saved to History.
              </p>
            </CardBody>
          </Card>

          {state.status === 'loading' ? <CreedSearching message={state.what} /> : null}
          {state.status === 'idle' ? (
            <div className="flex flex-col items-center gap-4 rounded-lg border border-dashed border-zinc-300 bg-white px-6 py-8 text-center sm:flex-row sm:text-left dark:border-zinc-700 dark:bg-zinc-900/40">
              <CreedGif size={200} />
              <div>
                <p className="text-base font-semibold text-zinc-900 dark:text-zinc-50">Who has been helping themselves to our stories?</p>
                <p className="mt-1 max-w-md text-sm text-zinc-600 dark:text-zinc-400">
                  Paste a story link above. You will see everyone sharing it on X, who passed around archive and paywall-bypass
                  copies, and who retold it without linking back.
                </p>
              </div>
            </div>
          ) : null}
          {state.status === 'error' ? (
            <p className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300">{state.message}</p>
          ) : null}
          {result ? <RunResults result={result} onRecheck={result.storyUrl ? () => run(result.storyUrl ?? '', terms, mentions) : undefined} /> : null}
        </>
      ) : null}
    </div>
  );
}
