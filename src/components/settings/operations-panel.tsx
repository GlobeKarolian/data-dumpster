'use client';

/**
 * The operator's control panel. Every dial here used to be a constant that
 * needed a deploy to turn. Each card owns one control key, saves explicitly,
 * and shows the live gauge next to the dial so nobody throttles a queue they
 * cannot see.
 */
import * as React from 'react';
import { Card, CardBody, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { MultiSelect } from '@/components/ui/multi-select';

type CommentPlatform = { enabled: boolean; dailyRecordBudget: number };
export interface OperationsControls {
  comments: {
    enabled: boolean;
    minPostAgeHours: number;
    maxPostAgeDays: number;
    postsPerPlatformPerTick: number;
    commentsPerPost: number;
    platforms: { instagram: CommentPlatform; tiktok: CommentPlatform };
    excludedCompanyIds: string[];
  };
  summaries: { enabled: boolean; postsPerTick: number };
  ingest: { enabled: boolean; recoverChannelsPerTick: number; refreshIntervalHours: number };
  groups: { enabled: boolean };
  refresh: { enabled: boolean };
}

export interface OperationsStatus {
  queueByPlatform: { platform: string; pending: number; blocked: number }[];
  spendToday: { vendor: string; records: number; cents: number }[];
  commentsToday: { platform: string; comments: number }[];
  summariesToday: number;
}

export interface CompanyOption {
  id: string;
  name: string;
}

function Toggle({ checked, onChange, disabled, label }: {
  checked: boolean;
  onChange: (next: boolean) => void;
  disabled?: boolean;
  label: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={[
        'relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors',
        checked ? 'bg-accent-600' : 'bg-zinc-300 dark:bg-zinc-700',
        disabled ? 'opacity-50' : 'cursor-pointer',
      ].join(' ')}
    >
      <span
        className={[
          'inline-block h-3.5 w-3.5 rounded-full bg-white shadow transition-transform',
          checked ? 'translate-x-[18px]' : 'translate-x-[3px]',
        ].join(' ')}
      />
    </button>
  );
}

function NumberField({ label, value, onChange, min, max, disabled, hint }: {
  label: string;
  value: number;
  onChange: (next: number) => void;
  min: number;
  max: number;
  disabled?: boolean;
  hint?: string;
}) {
  return (
    <label className="flex flex-col gap-1 text-xs text-zinc-600 dark:text-zinc-400">
      <span className="font-medium">{label}</span>
      <input
        type="number"
        value={value}
        min={min}
        max={max}
        disabled={disabled}
        onChange={(event) => onChange(Number(event.target.value))}
        className="w-28 rounded-md border border-zinc-300 bg-white px-2 py-1.5 text-sm text-zinc-900 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100"
      />
      {hint ? <span className="text-[11px] text-zinc-500">{hint}</span> : null}
    </label>
  );
}

function SwitchRow({ label, sub, checked, onChange, disabled }: {
  label: string;
  sub?: string;
  checked: boolean;
  onChange: (next: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <div className="flex items-center justify-between gap-3 py-1">
      <div>
        <p className="text-sm font-medium text-zinc-800 dark:text-zinc-200">{label}</p>
        {sub ? <p className="text-[11px] text-zinc-500">{sub}</p> : null}
      </div>
      <Toggle checked={checked} onChange={onChange} disabled={disabled} label={label} />
    </div>
  );
}

function useSaver<T>(key: string, initial: T) {
  const [value, setValue] = React.useState<T>(initial);
  const [saved, setSaved] = React.useState<T>(initial);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const dirty = JSON.stringify(value) !== JSON.stringify(saved);

  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch('/api/settings/operations', {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ key, value }),
      });
      if (!response.ok) {
        const payload = await response.json().catch(() => null);
        throw new Error(
          (payload && typeof payload === 'object' && 'error' in payload
            ? String((payload as { error: unknown }).error)
            : null) ?? 'Save failed (' + response.status + ').',
        );
      }
      setSaved(value);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Save failed.');
    } finally {
      setBusy(false);
    }
  };

  return { value, setValue, dirty, busy, error, save };
}

function SaveRow({ dirty, busy, error, onSave }: {
  dirty: boolean; busy: boolean; error: string | null; onSave: () => void;
}) {
  return (
    <div className="flex items-center justify-end gap-3 border-t border-zinc-100 pt-3 dark:border-zinc-800">
      {error ? <span className="text-xs text-red-600 dark:text-red-400">{error}</span> : null}
      {dirty && !error ? <span className="text-[11px] text-zinc-500">Unsaved changes</span> : null}
      <Button size="sm" disabled={!dirty || busy} onClick={onSave}>
        {busy ? 'Saving…' : 'Save'}
      </Button>
    </div>
  );
}

const PLATFORM_LABELS: Record<'instagram' | 'tiktok', string> = {
  instagram: 'Instagram',
  tiktok: 'TikTok',
};

export function OperationsPanel({ controls, status, companies }: {
  controls: OperationsControls;
  status: OperationsStatus;
  companies: CompanyOption[];
}) {
  const comments = useSaver('comments', controls.comments);
  const summaries = useSaver('summaries', controls.summaries);
  const ingest = useSaver('ingest', controls.ingest);
  const groups = useSaver('groups', controls.groups);
  const refresh = useSaver('refresh', controls.refresh);

  const totalPending = status.queueByPlatform.reduce((sum, row) => sum + row.pending, 0);
  const totalBlocked = status.queueByPlatform.reduce((sum, row) => sum + row.blocked, 0);
  const spendCents = status.spendToday.reduce((sum, row) => sum + row.cents, 0);
  const spendRecords = status.spendToday.reduce((sum, row) => sum + row.records, 0);
  const commentsToday = status.commentsToday.reduce((sum, row) => sum + row.comments, 0);

  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {[
          {
            label: 'Collection queue',
            value: String(totalPending),
            sub: totalBlocked > 0 ? totalBlocked + ' blocked, need attention' : 'channels pending or retrying',
          },
          {
            label: 'Vendor spend today',
            value: '$' + (spendCents / 100).toFixed(2),
            sub: spendRecords.toLocaleString() + ' records bought',
          },
          {
            label: 'Comments today',
            value: commentsToday.toLocaleString(),
            sub: status.commentsToday.map((row) => row.platform + ' ' + row.comments.toLocaleString()).join(' · ') || 'none yet',
          },
          {
            label: 'Summaries today',
            value: String(status.summariesToday),
            sub: 'model-written comment digests',
          },
        ].map((tile) => (
          <div key={tile.label} className="rounded-lg border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900/40">
            <p className="text-xs font-medium text-zinc-500">{tile.label}</p>
            <p className="pb-num mt-1 text-2xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">{tile.value}</p>
            <p className="mt-1 text-[11px] text-zinc-500">{tile.sub}</p>
          </div>
        ))}
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Comment crawling</CardTitle>
        </CardHeader>
        <CardBody className="flex flex-col gap-3">
          <SwitchRow
            label="Buy comment sections"
            sub="Master switch. Off stops every comment purchase on the next tick; nothing already bought is lost."
            checked={comments.value.enabled}
            onChange={(enabled) => comments.setValue({ ...comments.value, enabled })}
          />
          <div className="grid gap-3 sm:grid-cols-2">
            {(Object.keys(PLATFORM_LABELS) as ('instagram' | 'tiktok')[]).map((platform) => (
              <div key={platform} className="rounded-md border border-zinc-200 p-3 dark:border-zinc-800">
                <SwitchRow
                  label={PLATFORM_LABELS[platform]}
                  checked={comments.value.platforms[platform].enabled}
                  onChange={(enabled) => comments.setValue({
                    ...comments.value,
                    platforms: {
                      ...comments.value.platforms,
                      [platform]: { ...comments.value.platforms[platform], enabled },
                    },
                  })}
                  disabled={!comments.value.enabled}
                />
                <NumberField
                  label="Daily record budget"
                  value={comments.value.platforms[platform].dailyRecordBudget}
                  min={0}
                  max={1_000_000}
                  disabled={!comments.value.enabled || !comments.value.platforms[platform].enabled}
                  onChange={(dailyRecordBudget) => comments.setValue({
                    ...comments.value,
                    platforms: {
                      ...comments.value.platforms,
                      [platform]: { ...comments.value.platforms[platform], dailyRecordBudget },
                    },
                  })}
                  hint={'≈ $' + (comments.value.platforms[platform].dailyRecordBudget * 0.15 / 100).toFixed(2) + '/day ceiling'}
                />
              </div>
            ))}
          </div>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <NumberField
              label="Posts per platform per tick"
              value={comments.value.postsPerPlatformPerTick}
              min={1} max={50}
              disabled={!comments.value.enabled}
              onChange={(postsPerPlatformPerTick) => comments.setValue({ ...comments.value, postsPerPlatformPerTick })}
              hint="Ticks run twice an hour"
            />
            <NumberField
              label="Comments per post"
              value={comments.value.commentsPerPost}
              min={10} max={1000}
              disabled={!comments.value.enabled}
              onChange={(commentsPerPost) => comments.setValue({ ...comments.value, commentsPerPost })}
              hint="Most recent first"
            />
            <NumberField
              label="Min post age (hours)"
              value={comments.value.minPostAgeHours}
              min={0} max={168}
              disabled={!comments.value.enabled}
              onChange={(minPostAgeHours) => comments.setValue({ ...comments.value, minPostAgeHours })}
              hint="Let comments accrue first"
            />
            <NumberField
              label="Max post age (days)"
              value={comments.value.maxPostAgeDays}
              min={1} max={90}
              disabled={!comments.value.enabled}
              onChange={(maxPostAgeDays) => comments.setValue({ ...comments.value, maxPostAgeDays })}
              hint="Older sections lose news value"
            />
          </div>
          <div>
            <p className="mb-1 text-xs font-medium text-zinc-600 dark:text-zinc-400">Never buy comments for</p>
            <MultiSelect
              label="Excluded companies"
              allLabel="No exclusions"
              searchable
              options={companies.map((company) => ({ value: company.id, label: company.name }))}
              value={comments.value.excludedCompanyIds}
              onChange={(excludedCompanyIds) => comments.setValue({ ...comments.value, excludedCompanyIds })}
            />
          </div>
          <SaveRow dirty={comments.dirty} busy={comments.busy} error={comments.error} onSave={comments.save} />
        </CardBody>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Post &amp; profile ingestion</CardTitle>
        </CardHeader>
        <CardBody className="flex flex-col gap-3">
          <SwitchRow
            label="Ingest posts and profiles"
            sub="Master switch for scheduled and recovery crawls. Off pauses all paid post collection."
            checked={ingest.value.enabled}
            onChange={(enabled) => ingest.setValue({ ...ingest.value, enabled })}
          />
          <div className="grid gap-3 sm:grid-cols-2">
            <NumberField
              label="Refresh interval (hours)"
              value={ingest.value.refreshIntervalHours}
              min={1} max={168}
              disabled={!ingest.value.enabled}
              onChange={(refreshIntervalHours) => ingest.setValue({ ...ingest.value, refreshIntervalHours })}
              hint="How stale a channel may grow before re-crawl. Shipped default: 12."
            />
            <NumberField
              label="Channels per recovery tick"
              value={ingest.value.recoverChannelsPerTick}
              min={1} max={1000}
              disabled={!ingest.value.enabled}
              onChange={(recoverChannelsPerTick) => ingest.setValue({ ...ingest.value, recoverChannelsPerTick })}
              hint="The cron URL's own limit still caps one invocation"
            />
          </div>
          <SaveRow dirty={ingest.dirty} busy={ingest.busy} error={ingest.error} onSave={ingest.save} />
        </CardBody>
      </Card>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card>
          <CardHeader><CardTitle>Comment summaries</CardTitle></CardHeader>
          <CardBody className="flex flex-col gap-3">
            <SwitchRow
              label="Write summaries"
              checked={summaries.value.enabled}
              onChange={(enabled) => summaries.setValue({ ...summaries.value, enabled })}
            />
            <NumberField
              label="Posts per tick"
              value={summaries.value.postsPerTick}
              min={1} max={100}
              disabled={!summaries.value.enabled}
              onChange={(postsPerTick) => summaries.setValue({ ...summaries.value, postsPerTick })}
            />
            <SaveRow dirty={summaries.dirty} busy={summaries.busy} error={summaries.error} onSave={summaries.save} />
          </CardBody>
        </Card>
        <Card>
          <CardHeader><CardTitle>Facebook groups</CardTitle></CardHeader>
          <CardBody className="flex flex-col gap-3">
            <SwitchRow
              label="Collect group posts"
              checked={groups.value.enabled}
              onChange={(enabled) => groups.setValue({ enabled })}
            />
            <SaveRow dirty={groups.dirty} busy={groups.busy} error={groups.error} onSave={groups.save} />
          </CardBody>
        </Card>
        <Card>
          <CardHeader><CardTitle>Metrics refresh</CardTitle></CardHeader>
          <CardBody className="flex flex-col gap-3">
            <SwitchRow
              label="Refresh derived metrics"
              checked={refresh.value.enabled}
              onChange={(enabled) => refresh.setValue({ enabled })}
            />
            <SaveRow dirty={refresh.dirty} busy={refresh.busy} error={refresh.error} onSave={refresh.save} />
          </CardBody>
        </Card>
      </div>

      <p className="text-[11px] leading-relaxed text-zinc-500">
        Every dial takes effect on the next cron tick, within ten minutes for ingestion and half an
        hour for comments. A deleted or never-saved control means the shipped default; saving writes
        only your departure from it.
      </p>
    </div>
  );
}
