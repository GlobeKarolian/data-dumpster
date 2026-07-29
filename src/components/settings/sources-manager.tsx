'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { Loader2, Plus, Radio, Trash2 } from 'lucide-react';
import { PLATFORMS, PLATFORM_COLORS, PLATFORM_LABELS, type Platform } from '@/lib/types';
import { cn } from '@/lib/utils';
import { Card, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Field, Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { Toggle } from '@/components/ui/toggle';
import { Badge, Dot } from '@/components/ui/badge';
import { EmptyState } from '@/components/ui/empty-state';
import { Tooltip } from '@/components/ui/tooltip';
import { formatRelative } from '@/components/ui/format';

export interface ChannelRecord {
  id: string;
  platform: Platform;
  handle: string;
  profileUrl: string | null;
  active: boolean;
  isOwned: boolean;
  lastIngestedAt: string | null;
  lastRunStatus: string | null;
  lastRunError: string | null;
  postCount: number;
}

export interface CompanySources {
  id: string;
  name: string;
  channels: ChannelRecord[];
}

type Status = 'healthy' | 'stale' | 'failing' | 'never';

/** Twenty-six hours: one daily cycle plus slack, so a normal late run is not an alarm. */
const STALE_AFTER_MS = 26 * 60 * 60 * 1000;

function statusOf(c: ChannelRecord): Status {
  if (c.lastRunStatus === 'failed') return 'failing';
  if (!c.lastIngestedAt) return 'never';
  const age = Date.now() - new Date(c.lastIngestedAt).getTime();
  return age > STALE_AFTER_MS ? 'stale' : 'healthy';
}

const STATUS_COLOR: Record<Status, string> = {
  healthy: '#10b981',
  stale: '#f59e0b',
  failing: '#ef4444',
  never: '#a1a1aa',
};

const STATUS_COPY: Record<Status, string> = {
  healthy: 'Ingested within the last day.',
  stale: 'No successful ingest in over a day. The numbers on every screen are older than they look.',
  failing: 'The last ingest run failed. This channel is contributing stale data to every comparison.',
  never: 'Never ingested. Nothing from this channel is in the data yet.',
};

/**
 * Sources.
 *
 * The status dot is the point of this screen. Every comparison in Pressbox is
 * only as honest as the freshness of the channels behind it, so a stale feed has
 * to be visible here rather than silently dragging an average down.
 */
export function SourcesManager({ companies }: { companies: CompanySources[] }) {
  const router = useRouter();
  const [addingFor, setAddingFor] = React.useState<string | null>(null);
  const [busyId, setBusyId] = React.useState<string | null>(null);
  const [error, setError] = React.useState<string | null>(null);

  const removeChannel = async (companyId: string, channelId: string) => {
    setBusyId(channelId);
    setError(null);
    try {
      const res = await fetch('/api/companies/' + companyId + '/channels', {
        method: 'DELETE',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ channelId }),
      });
      if (!res.ok) throw new Error('Remove failed with status ' + res.status + '.');
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not remove the channel.');
    } finally {
      setBusyId(null);
    }
  };

  if (companies.length === 0) {
    return (
      <Card>
        <EmptyState
          icon={Radio}
          title="No companies to connect"
          description="Add the companies you want to measure first; channels hang off them."
          action={{ label: 'Add companies', href: '/settings/companies' }}
        />
      </Card>
    );
  }

  return (
    <div className="space-y-3">
      {error ? (
        <p className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700 dark:border-red-900/50 dark:bg-red-950/30 dark:text-red-400">
          {error}
        </p>
      ) : null}

      {companies.map((company) => (
        <Card key={company.id}>
          <CardHeader>
            <div>
              <CardTitle>{company.name}</CardTitle>
              <p className="mt-0.5 text-xs text-zinc-500 dark:text-zinc-400">
                {company.channels.length === 0
                  ? 'No channels connected'
                  : company.channels.length + (company.channels.length === 1 ? ' channel' : ' channels')}
              </p>
            </div>
            <Button
              size="sm"
              onClick={() => setAddingFor((prev) => (prev === company.id ? null : company.id))}
            >
              <Plus className="h-3 w-3" aria-hidden />
              Add channel
            </Button>
          </CardHeader>

          {addingFor === company.id ? (
            <div className="border-b border-zinc-200 bg-zinc-50 p-4 dark:border-zinc-800 dark:bg-zinc-900/40">
              <AddChannelForm
                companyId={company.id}
                existing={company.channels.map((c) => c.platform)}
                onDone={() => {
                  setAddingFor(null);
                  router.refresh();
                }}
                onCancel={() => setAddingFor(null)}
              />
            </div>
          ) : null}

          {company.channels.length === 0 ? (
            <EmptyState
              compact
              title="Nothing connected yet"
              description="Paste a profile URL or a handle. Pressbox resolves it to a platform id on the first ingest."
            />
          ) : (
            <ul className="divide-y divide-zinc-100 dark:divide-zinc-800/60">
              {company.channels.map((channel) => {
                const status = statusOf(channel);
                return (
                  <li key={channel.id} className="flex items-center gap-3 px-4 py-2.5">
                    <Tooltip
                      side="top"
                      content={
                        <span className="block">
                          <span className="block font-medium text-zinc-900 dark:text-zinc-100">
                            {STATUS_COPY[status]}
                          </span>
                          {channel.lastRunError ? (
                            <span className="block text-red-600 dark:text-red-400">{channel.lastRunError}</span>
                          ) : null}
                        </span>
                      }
                    >
                      <span tabIndex={0} className="inline-flex">
                        <Dot color={STATUS_COLOR[status]} />
                      </span>
                    </Tooltip>

                    <span
                      aria-hidden
                      className="h-2 w-2 shrink-0 rounded-full"
                      style={{ backgroundColor: PLATFORM_COLORS[channel.platform] }}
                    />
                    <span className="w-24 shrink-0 text-xs text-zinc-600 dark:text-zinc-400">
                      {PLATFORM_LABELS[channel.platform]}
                    </span>

                    <span className="min-w-0 flex-1 truncate text-xs text-zinc-900 dark:text-zinc-100">
                      {channel.profileUrl ? (
                        <a
                          href={channel.profileUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="hover:text-accent-600 hover:underline"
                        >
                          {channel.handle}
                        </a>
                      ) : (
                        channel.handle
                      )}
                      {channel.isOwned ? <Badge tone="outline" className="ml-2">Owned</Badge> : null}
                      {channel.active ? null : <Badge tone="outline" className="ml-2">Paused</Badge>}
                    </span>

                    <span className={cn('pb-num w-28 shrink-0 text-right text-[11px]', status === 'failing' ? 'text-red-600 dark:text-red-400' : 'text-zinc-400')}>
                      {formatRelative(channel.lastIngestedAt)}
                    </span>
                    <span className="pb-num w-16 shrink-0 text-right text-[11px] text-zinc-400">
                      {channel.postCount.toLocaleString('en-US')}
                    </span>

                    <Button
                      size="icon"
                      variant="ghost"
                      aria-label={'Remove ' + channel.handle}
                      disabled={busyId === channel.id}
                      onClick={() => removeChannel(company.id, channel.id)}
                    >
                      {busyId === channel.id ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
                      ) : (
                        <Trash2 className="h-3.5 w-3.5" aria-hidden />
                      )}
                    </Button>
                  </li>
                );
              })}
            </ul>
          )}
        </Card>
      ))}
    </div>
  );
}

function AddChannelForm({
  companyId,
  existing,
  onDone,
  onCancel,
}: {
  companyId: string;
  existing: Platform[];
  onDone: () => void;
  onCancel: () => void;
}) {
  const [platform, setPlatform] = React.useState<Platform>(
    PLATFORMS.find((p) => !existing.includes(p)) ?? 'facebook',
  );
  const [input, setInput] = React.useState('');
  const [isOwned, setIsOwned] = React.useState(false);
  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim()) return;
    setSaving(true);
    setError(null);
    try {
      const res = await fetch('/api/companies/' + companyId + '/channels', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ platform, input: input.trim(), isOwned }),
      });
      if (!res.ok) {
        // The API returns { error, code }. Showing the raw JSON envelope to a
        // newsroom user is how you get a support ticket, so unwrap it and fall
        // back to the body only when it is not the shape we expect.
        const detail = await res.text();
        let message = detail.slice(0, 300);
        try {
          const parsed: unknown = JSON.parse(detail);
          if (parsed && typeof parsed === 'object' && 'error' in parsed) {
            message = String((parsed as { error: unknown }).error);
          }
        } catch { /* not JSON, use the raw text */ }
        throw new Error(message || 'Add failed with status ' + res.status + '.');
      }
      onDone();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not add the channel.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <form onSubmit={submit} className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-[10rem_1fr]">
        <Field label="Platform">
          <Select
            value={platform}
            onChange={(e) => setPlatform(e.target.value as Platform)}
            options={PLATFORMS.map((p) => ({ value: p, label: PLATFORM_LABELS[p] }))}
          />
        </Field>
        <Field
          label="Handle or profile URL"
          hint="Either works. A full URL is safer when a brand uses different handles on different networks."
        >
          <Input
            autoFocus
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="bostonglobe or https://www.instagram.com/bostonglobe"
            required
          />
        </Field>
      </div>

      <Toggle
        checked={isOwned}
        onChange={setIsOwned}
        label="We own this channel"
        description="Owned channels can use platform insights APIs when credentials are configured, which unlocks reach and view figures that public data does not expose."
      />

      {error ? <p className="text-[11px] text-red-600 dark:text-red-400">{error}</p> : null}

      <div className="flex items-center gap-2">
        <Button type="submit" variant="primary" size="sm" disabled={saving}>
          {saving ? <Loader2 className="h-3 w-3 animate-spin" aria-hidden /> : null}
          Add channel
        </Button>
        <Button type="button" size="sm" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </form>
  );
}
