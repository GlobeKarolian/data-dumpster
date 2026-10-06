'use client';

import * as React from 'react';
import { ExternalLink, Pin, Trash2 } from 'lucide-react';
import { Card, CardBody, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Field, Input, Textarea } from '@/components/ui/input';
import { api, fmtWhen } from './api';
import { usePublish } from './shell';

export function LinkInBioPage() {
  const { canApprove } = usePublish();
  return <LinkInBio canApprove={canApprove} />;
}

interface BioLink {
  id: string; title: string; url: string; image_url: string | null;
  starts_at: string; ends_at: string | null; pinned: boolean; delivery_id: string | null;
}
interface BioPage { id: string; slug: string; title: string; brand: string; avatar_url: string | null; links: BioLink[] }

function state(l: BioLink): { label: string; tone: 'positive' | 'accent' | 'outline' } {
  const now = Date.now();
  if (new Date(l.starts_at).getTime() > now) return { label: 'Scheduled ' + fmtWhen(l.starts_at), tone: 'accent' };
  if (l.ends_at && new Date(l.ends_at).getTime() <= now) return { label: 'Expired', tone: 'outline' };
  return { label: 'Live', tone: 'positive' };
}

/** Parse "Title | URL" lines, or bare URLs, from a pasted Later / Linktree list. */
export function parseImport(text: string): { title: string; url: string }[] {
  return text.split('\n').map((line) => line.trim()).filter(Boolean).flatMap((line) => {
    const url = line.match(/https?:\/\/\S+/)?.[0];
    if (!url) return [];
    const title = line.replace(url, '').replace(/[|\-–—:\t]+\s*$/, '').replace(/^\s*[|\-–—:\t]+/, '').trim();
    return [{ title: title || url, url }];
  });
}

export function LinkInBio({ canApprove }: { canApprove: boolean }) {
  const [pages, setPages] = React.useState<BioPage[]>([]);
  const [error, setError] = React.useState<string | null>(null);
  const [newPage, setNewPage] = React.useState({ slug: '', title: '', brand: '' });

  const load = React.useCallback(async () => {
    try { setPages((await api<{ pages: BioPage[] }>('/api/publishing/bio')).pages); setError(null); }
    catch (e) { setError((e as Error).message); }
  }, []);
  // Deferred a tick so the effect itself sets no state (react-hooks rule).
  React.useEffect(() => { void Promise.resolve().then(load); }, [load]);

  const createPage = async () => {
    try {
      await api('/api/publishing/bio', { method: 'POST', json: { ...newPage, avatarUrl: null } });
      setNewPage({ slug: '', title: '', brand: '' });
      load();
    } catch (e) { setError((e as Error).message); }
  };

  return (
    <div className="space-y-4">
      {error ? <p className="text-sm text-red-600">{error}</p> : null}
      <p className="text-xs text-zinc-500">
        Instagram and TikTok posts with a story link add it here automatically, timed to go live when the post does.
        You can also schedule links by hand, set them to expire, and pin evergreen ones.
      </p>
      {pages.map((p) => <PageCard key={p.id} page={p} onChange={load} />)}
      {canApprove ? (
        <Card>
          <CardHeader><CardTitle>New link-in-bio page</CardTitle></CardHeader>
          <CardBody className="grid gap-3 sm:grid-cols-4">
            <Field label="Brand"><Input value={newPage.brand} onChange={(e) => setNewPage({ ...newPage, brand: e.target.value })} placeholder="Boston.com" /></Field>
            <Field label="Page title"><Input value={newPage.title} onChange={(e) => setNewPage({ ...newPage, title: e.target.value })} placeholder="Boston.com" /></Field>
            <Field label="Address" hint={`/links/${newPage.slug || 'bostondotcom'}`}>
              <Input value={newPage.slug} onChange={(e) => setNewPage({ ...newPage, slug: e.target.value.toLowerCase() })} placeholder="bostondotcom" />
            </Field>
            <div className="flex items-end"><Button variant="primary" onClick={createPage} disabled={!newPage.slug || !newPage.title || !newPage.brand}>Create page</Button></div>
          </CardBody>
        </Card>
      ) : null}
    </div>
  );
}

function PageCard({ page, onChange }: { page: BioPage; onChange: () => void }) {
  const [title, setTitle] = React.useState('');
  const [url, setUrl] = React.useState('');
  const [startsAt, setStartsAt] = React.useState('');
  const [endsAt, setEndsAt] = React.useState('');
  const [importText, setImportText] = React.useState('');
  const [showImport, setShowImport] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const add = async (links: unknown[]) => {
    setError(null);
    try {
      await api('/api/publishing/bio/links', { method: 'POST', json: { pageId: page.id, links } });
      setTitle(''); setUrl(''); setStartsAt(''); setEndsAt(''); setImportText(''); setShowImport(false);
      onChange();
    } catch (e) { setError((e as Error).message); }
  };
  const patch = async (l: BioLink, over: Partial<{ pinned: boolean; endsAt: string | null }>) => {
    try {
      await api(`/api/publishing/bio/links/${l.id}`, { method: 'PATCH', json: {
        title: l.title, url: l.url, startsAt: l.starts_at, endsAt: 'endsAt' in over ? over.endsAt : l.ends_at, pinned: over.pinned ?? l.pinned,
      } });
      onChange();
    } catch (e) { setError((e as Error).message); }
  };
  const remove = async (l: BioLink) => {
    await api(`/api/publishing/bio/links/${l.id}`, { method: 'DELETE' }).catch((e) => setError((e as Error).message));
    onChange();
  };
  const parsed = parseImport(importText);

  return (
    <Card>
      <CardHeader>
        <div>
          <CardTitle>{page.title}</CardTitle>
          <CardDescription>{page.brand}</CardDescription>
        </div>
        <a href={`/links/${page.slug}`} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-xs text-accent-700 hover:underline dark:text-accent-400">
          /links/{page.slug} <ExternalLink className="h-3 w-3" />
        </a>
      </CardHeader>
      <CardBody className="space-y-4">
        <div className="grid gap-2 sm:grid-cols-[1fr_1fr_11rem_11rem_auto]">
          <Input aria-label="Link title" placeholder="Title" value={title} onChange={(e) => setTitle(e.target.value)} />
          <Input aria-label="Link URL" placeholder="https://" value={url} onChange={(e) => setUrl(e.target.value)} />
          <Input aria-label="Goes live" type="datetime-local" value={startsAt} onChange={(e) => setStartsAt(e.target.value)} title="Goes live (blank = now)" />
          <Input aria-label="Expires" type="datetime-local" value={endsAt} onChange={(e) => setEndsAt(e.target.value)} title="Expires (optional)" />
          <Button variant="primary" disabled={!title || !url} onClick={() => add([{
            title, url,
            startsAt: startsAt ? new Date(startsAt).toISOString() : null,
            endsAt: endsAt ? new Date(endsAt).toISOString() : null,
          }])}>Add</Button>
        </div>
        <div>
          <Button size="sm" variant="ghost" onClick={() => setShowImport(!showImport)}>{showImport ? 'Close import' : 'Import existing links'}</Button>
          {showImport ? (
            <div className="mt-2 space-y-2">
              <Textarea rows={5} value={importText} onChange={(e) => setImportText(e.target.value)}
                placeholder={'Paste your current list, one per line:\nRed Sox playoff guide | https://www.boston.com/...\nhttps://www.boston.com/...'} />
              <Button size="sm" variant="primary" disabled={!parsed.length} onClick={() => add(parsed)}>
                Import {parsed.length} link{parsed.length === 1 ? '' : 's'}
              </Button>
            </div>
          ) : null}
        </div>
        {error ? <p className="text-xs text-red-600">{error}</p> : null}
        <ul className="divide-y divide-zinc-100 dark:divide-zinc-800">
          {page.links.map((l) => {
            const s = state(l);
            return (
              <li key={l.id} className="flex flex-col gap-1 py-2 text-xs sm:flex-row sm:items-center sm:gap-3">
                <div className="min-w-0 flex-1">
                  <p className="truncate font-medium text-zinc-900 dark:text-zinc-100">{l.title}</p>
                  <p className="truncate text-zinc-500">{l.url}</p>
                </div>
                <div className="flex shrink-0 flex-wrap items-center gap-1.5">
                  {l.pinned ? <Badge tone="neutral"><Pin className="h-3 w-3" />Pinned</Badge> : null}
                  {l.delivery_id ? <Badge tone="outline">From a post</Badge> : null}
                  <Badge tone={s.tone}>{s.label}</Badge>
                  {l.ends_at && s.label !== 'Expired' ? <span className="text-zinc-500">until {fmtWhen(l.ends_at)}</span> : null}
                  <Button size="sm" variant="ghost" onClick={() => patch(l, { pinned: !l.pinned })}>{l.pinned ? 'Unpin' : 'Pin'}</Button>
                  {s.label === 'Live' ? (
                    <Button size="sm" variant="ghost" onClick={() => patch(l, { endsAt: new Date().toISOString() })}>Take down</Button>
                  ) : null}
                  <Button size="icon" variant="ghost" aria-label="Delete link" onClick={() => remove(l)}><Trash2 className="h-3.5 w-3.5" /></Button>
                </div>
              </li>
            );
          })}
          {!page.links.length ? <li className="py-4 text-center text-xs text-zinc-500">No links yet.</li> : null}
        </ul>
        <p className="text-[11px] text-zinc-500">Times shown in Boston time.</p>
      </CardBody>
    </Card>
  );
}
