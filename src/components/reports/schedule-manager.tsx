'use client';

import * as React from 'react';
import Link from 'next/link';
import {
  CalendarClock,
  FileText,
  Loader2,
  Mail,
  MessageSquare,
  Pencil,
  Play,
  Plus,
  Trash2,
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardHeader, CardTitle } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { Field, Input, Textarea } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { Checkbox, Toggle } from '@/components/ui/toggle';
import { formatRelative } from '@/components/ui/format';
import { canReleaseManualRunKey } from '@/lib/reports/delivery-state';

type ReportFormat = 'pptx' | 'csv';

type DeliveryRecord = {
  id: string;
  scheduleId: string | null;
  reportId: string | null;
  scheduledFor: string;
  formats: ReportFormat[];
  recipients: string[];
  includeSlack: boolean;
  status: string;
  attemptCount: number;
  destinations: {
    email: {
      status: string;
      providerMessageId: string | null;
      error: string | null;
      attemptedAt: string | null;
      finishedAt: string | null;
    };
    slack: {
      status: string;
      error: string | null;
      attemptedAt: string | null;
      finishedAt: string | null;
    };
  };
  error: string | null;
  startedAt: string;
  finishedAt: string | null;
};

export type ReportScheduleRecord = {
  id: string;
  landscapeId: string;
  name: string;
  recipients: string[];
  formats: ReportFormat[];
  includeSlack: boolean;
  dayOfWeek: number;
  hour: number;
  timeZone: string;
  enabled: boolean;
  lastRunAt: string | null;
  lastSuccessAt: string | null;
  lastError: string | null;
  createdAt: string;
  updatedAt: string;
  deliveries: DeliveryRecord[];
};

type ScheduleDraft = {
  name: string;
  recipients: string;
  formats: ReportFormat[];
  includeSlack: boolean;
  dayOfWeek: number;
  hour: number;
  timeZone: string;
  enabled: boolean;
};

const WEEKDAYS = [
  { value: '1', label: 'Monday' },
  { value: '2', label: 'Tuesday' },
  { value: '3', label: 'Wednesday' },
  { value: '4', label: 'Thursday' },
  { value: '5', label: 'Friday' },
  { value: '6', label: 'Saturday' },
  { value: '7', label: 'Sunday' },
];

const HOURS = Array.from({ length: 24 }, (_, hour) => ({
  value: String(hour),
  label: new Intl.DateTimeFormat('en-US', {
    hour: 'numeric',
    timeZone: 'UTC',
  }).format(new Date(Date.UTC(2026, 0, 1, hour))),
}));

const COMMON_TIME_ZONES = [
  { value: 'America/New_York', label: 'Eastern time' },
  { value: 'America/Chicago', label: 'Central time' },
  { value: 'America/Denver', label: 'Mountain time' },
  { value: 'America/Los_Angeles', label: 'Pacific time' },
  { value: 'UTC', label: 'UTC' },
];

const EMPTY_DRAFT: ScheduleDraft = {
  name: 'Weekly leadership report',
  recipients: '',
  formats: ['pptx', 'csv'],
  includeSlack: false,
  dayOfWeek: 1,
  hour: 8,
  timeZone: 'America/New_York',
  enabled: true,
};

function scheduleDraft(schedule: ReportScheduleRecord): ScheduleDraft {
  return {
    name: schedule.name,
    recipients: schedule.recipients.join(', '),
    formats: schedule.formats,
    includeSlack: schedule.includeSlack,
    dayOfWeek: schedule.dayOfWeek,
    hour: schedule.hour,
    timeZone: schedule.timeZone,
    enabled: schedule.enabled,
  };
}

function recipients(value: string): string[] {
  return Array.from(new Set(
    value
      .split(/[\n,;]+/)
      .map((item) => item.trim().toLowerCase())
      .filter(Boolean),
  ));
}

async function responseError(response: Response, fallback: string): Promise<Error> {
  const payload: unknown = await response.json().catch(() => null);
  if (typeof payload === 'object' && payload !== null && 'error' in payload) {
    return new Error(String((payload as { error: unknown }).error));
  }
  return new Error(fallback + ' (status ' + response.status + ').');
}

function scheduleDescription(schedule: ReportScheduleRecord): string {
  const day = WEEKDAYS.find((item) => item.value === String(schedule.dayOfWeek))?.label
    ?? 'Weekly';
  const hour = HOURS.find((item) => item.value === String(schedule.hour))?.label
    ?? String(schedule.hour) + ':00';
  return day + 's at ' + hour + ' · ' + schedule.timeZone;
}

function deliveryLabel(delivery: DeliveryRecord): string {
  if (delivery.scheduledFor.startsWith('manual:')) return 'Run now';
  return 'Scheduled delivery';
}

function statusTone(status: string): 'positive' | 'critical' | 'warning' | 'neutral' {
  if (status === 'succeeded') return 'positive';
  if (status === 'failed') return 'critical';
  if (status === 'running') return 'warning';
  return 'neutral';
}

export function ScheduleManager({
  landscapeId,
  canEdit,
  automationEnabled,
}: {
  landscapeId: string;
  canEdit: boolean;
  automationEnabled: boolean;
}) {
  const [items, setItems] = React.useState<ReportScheduleRecord[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [creating, setCreating] = React.useState(false);
  const [editingId, setEditingId] = React.useState<string | null>(null);
  const [busyId, setBusyId] = React.useState<string | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [notice, setNotice] = React.useState<string | null>(null);
  const manualRunKeys = React.useRef(new Map<string, string>());

  const load = React.useCallback(async () => {
    try {
      const response = await fetch(
        '/api/report-schedules?landscapeId=' + encodeURIComponent(landscapeId),
        { cache: 'no-store' },
      );
      if (!response.ok) {
        throw await responseError(response, 'Schedules could not be loaded');
      }
      const payload = (await response.json()) as { items?: ReportScheduleRecord[] };
      setItems(Array.isArray(payload.items) ? payload.items : []);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Schedules could not be loaded.');
    } finally {
      setLoading(false);
    }
  }, [landscapeId]);

  React.useEffect(() => {
    const timeout = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timeout);
  }, [load]);

  const save = async (draft: ScheduleDraft, id?: string) => {
    const emails = recipients(draft.recipients);
    if (draft.formats.length === 0) {
      throw new Error('Choose at least one file format.');
    }
    if (emails.length === 0 && !draft.includeSlack) {
      throw new Error('Add an email recipient or turn on Slack delivery.');
    }

    setBusyId(id ?? 'new');
    setError(null);
    setNotice(null);
    try {
      const response = await fetch(id ? '/api/report-schedules/' + id : '/api/report-schedules', {
        method: id ? 'PATCH' : 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          landscapeId,
          name: draft.name.trim(),
          recipients: emails,
          formats: draft.formats,
          includeSlack: draft.includeSlack,
          dayOfWeek: draft.dayOfWeek,
          hour: draft.hour,
          timeZone: draft.timeZone,
          enabled: automationEnabled ? draft.enabled : false,
        }),
      });
      if (!response.ok) {
        throw await responseError(response, id ? 'Schedule could not be saved' : 'Schedule could not be created');
      }
      setCreating(false);
      setEditingId(null);
      setNotice(id ? 'Schedule saved.' : 'Schedule created.');
      await load();
    } finally {
      setBusyId(null);
    }
  };

  const toggle = async (schedule: ReportScheduleRecord, enabled: boolean) => {
    setBusyId(schedule.id + ':toggle');
    setError(null);
    setNotice(null);
    try {
      const response = await fetch('/api/report-schedules/' + schedule.id, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ enabled }),
      });
      if (!response.ok) throw await responseError(response, 'Schedule could not be updated');
      setNotice(enabled ? 'Scheduled delivery turned on.' : 'Scheduled delivery paused.');
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Schedule could not be updated.');
    } finally {
      setBusyId(null);
    }
  };

  const runNow = async (schedule: ReportScheduleRecord) => {
    setBusyId(schedule.id + ':run');
    setError(null);
    setNotice(null);
    const storageKey = 'data-dumpster:report-run:' + schedule.id;
    let idempotencyKey = manualRunKeys.current.get(schedule.id)
      ?? window.sessionStorage.getItem(storageKey);
    if (!idempotencyKey) {
      idempotencyKey = crypto.randomUUID();
      manualRunKeys.current.set(schedule.id, idempotencyKey);
      window.sessionStorage.setItem(storageKey, idempotencyKey);
    }
    try {
      const response = await fetch('/api/report-schedules/' + schedule.id + '/run', {
        method: 'POST',
        headers: { 'Idempotency-Key': idempotencyKey },
      });
      if (!response.ok) throw await responseError(response, 'The report could not be sent');
      const outcome = (await response.json()) as {
        status?: string;
        alreadySucceeded?: boolean;
        error?: string;
      };
      if (outcome.status === 'failed') {
        throw new Error(outcome.error || 'The report was built, but delivery failed.');
      }
      if (!canReleaseManualRunKey(outcome)) {
        throw new Error(
          outcome.status === 'skipped'
            ? 'This run is still in progress or its outcome is uncertain. '
              + 'Retrying will reuse the same run.'
            : 'The delivery outcome was not definitive. Retrying will reuse this run.',
        );
      }
      manualRunKeys.current.delete(schedule.id);
      window.sessionStorage.removeItem(storageKey);
      setNotice(
        outcome.status === 'skipped'
          ? 'This report was already sent.'
          : 'The report was built and sent.',
      );
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'The report could not be sent.');
      await load();
    } finally {
      setBusyId(null);
    }
  };

  const remove = async (schedule: ReportScheduleRecord) => {
    if (!window.confirm(
      'Delete "' + schedule.name + '"? Its delivery history will remain in the audit log.',
    )) return;

    setBusyId(schedule.id + ':delete');
    setError(null);
    setNotice(null);
    try {
      const response = await fetch('/api/report-schedules/' + schedule.id, {
        method: 'DELETE',
      });
      if (!response.ok) throw await responseError(response, 'Schedule could not be deleted');
      setEditingId(null);
      setNotice('Schedule deleted.');
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Schedule could not be deleted.');
    } finally {
      setBusyId(null);
    }
  };

  return (
    <Card>
      <CardHeader>
        <div>
          <CardTitle>Scheduled delivery</CardTitle>
          <p className="mt-0.5 text-xs text-zinc-500 dark:text-zinc-400">
            {automationEnabled
              ? 'Send the finished weekly report as PowerPoint and CSV without opening the app.'
              : 'Configure delivery and use Run now; the automatic dispatcher is currently paused.'}
          </p>
        </div>
        {canEdit ? (
          <Button
            size="sm"
            variant="primary"
            onClick={() => {
              setCreating((value) => !value);
              setEditingId(null);
              setError(null);
            }}
          >
            <Plus className="h-3 w-3" aria-hidden />
            New schedule
          </Button>
        ) : null}
      </CardHeader>

      {!automationEnabled ? (
        <p className="border-b border-amber-200 bg-amber-50 px-4 py-2 text-xs leading-relaxed text-amber-800 dark:border-amber-900/60 dark:bg-amber-950/25 dark:text-amber-300">
          Automatic delivery is off for this deployment. Saved schedules remain paused; Run now still works.
        </p>
      ) : null}

      {error ? (
        <p
          role="alert"
          className="border-b border-red-200 bg-red-50 px-4 py-2 text-xs text-red-700 dark:border-red-900/50 dark:bg-red-950/30 dark:text-red-400"
        >
          {error}
        </p>
      ) : null}
      {notice ? (
        <p
          role="status"
          className="border-b border-emerald-200 bg-emerald-50 px-4 py-2 text-xs text-emerald-700 dark:border-emerald-900/50 dark:bg-emerald-950/30 dark:text-emerald-400"
        >
          {notice}
        </p>
      ) : null}

      {creating ? (
        <div className="border-b border-zinc-200 bg-zinc-50 p-4 dark:border-zinc-800 dark:bg-zinc-900/40">
          <ScheduleForm
            initial={{ ...EMPTY_DRAFT, enabled: automationEnabled }}
            saving={busyId === 'new'}
            automationEnabled={automationEnabled}
            onSave={async (draft) => {
              try {
                await save(draft);
              } catch (err) {
                setError(err instanceof Error ? err.message : 'Schedule could not be created.');
              }
            }}
            onCancel={() => setCreating(false)}
          />
        </div>
      ) : null}

      {loading ? (
        <div className="flex min-h-32 items-center justify-center gap-2 text-xs text-zinc-500">
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
          Loading schedules
        </div>
      ) : items.length === 0 && !creating ? (
        <EmptyState
          compact
          icon={CalendarClock}
          title="No scheduled reports"
          description={canEdit
            ? 'Choose who should receive the weekly report, the file formats, and when it should arrive.'
            : 'An admin can set up automatic weekly report delivery for this landscape.'}
        />
      ) : (
        <ul className="divide-y divide-zinc-100 dark:divide-zinc-800/60">
          {items.map((schedule) => (
            <li key={schedule.id}>
              <div className="flex flex-wrap items-start gap-3 px-4 py-3">
                <div className="pt-0.5">
                  <Toggle
                    hideLabel
                    label={(schedule.enabled ? 'Pause ' : 'Enable ') + schedule.name}
                    checked={schedule.enabled}
                    disabled={!automationEnabled || !canEdit || busyId !== null}
                    onChange={(enabled) => void toggle(schedule, enabled)}
                  />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className="text-sm font-medium text-zinc-900 dark:text-zinc-100">
                      {schedule.name}
                    </span>
                    {!schedule.enabled ? <Badge tone="outline">Paused</Badge> : null}
                    {!automationEnabled ? <Badge tone="warning">Dispatcher paused</Badge> : null}
                    {schedule.formats.map((format) => (
                      <Badge key={format} tone="neutral">{format.toUpperCase()}</Badge>
                    ))}
                    {schedule.includeSlack ? <Badge tone="outline">Slack</Badge> : null}
                  </div>
                  <p className="pb-num mt-0.5 text-[11px] text-zinc-500">
                    {scheduleDescription(schedule)}
                  </p>
                  <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-zinc-400 dark:text-zinc-500">
                    {schedule.recipients.length > 0 ? (
                      <span className="inline-flex items-center gap-1">
                        <Mail className="h-3 w-3" aria-hidden />
                        {schedule.recipients.length + (schedule.recipients.length === 1
                          ? ' email recipient'
                          : ' email recipients')}
                      </span>
                    ) : null}
                    {schedule.includeSlack ? (
                      <span className="inline-flex items-center gap-1">
                        <MessageSquare className="h-3 w-3" aria-hidden />
                        Newsroom Slack
                      </span>
                    ) : null}
                    <span>
                      Last successful delivery {formatRelative(schedule.lastSuccessAt)}
                    </span>
                  </div>
                  {schedule.lastError ? (
                    <p className="mt-1 max-w-3xl text-[11px] leading-relaxed text-red-600 dark:text-red-400">
                      Last attempt failed: {schedule.lastError}
                    </p>
                  ) : null}
                </div>
                {canEdit ? (
                  <div className="flex shrink-0 items-center gap-1">
                    <Button
                      size="sm"
                      onClick={() => {
                        setEditingId(editingId === schedule.id ? null : schedule.id);
                        setCreating(false);
                        setError(null);
                      }}
                      disabled={busyId !== null}
                    >
                      <Pencil className="h-3 w-3" aria-hidden />
                      Edit
                    </Button>
                    <Button
                      size="sm"
                      variant="primary"
                      onClick={() => void runNow(schedule)}
                      disabled={busyId !== null}
                    >
                      {busyId === schedule.id + ':run'
                        ? <Loader2 className="h-3 w-3 animate-spin" aria-hidden />
                        : <Play className="h-3 w-3" aria-hidden />}
                      {busyId === schedule.id + ':run' ? 'Sending' : 'Run now'}
                    </Button>
                    <Button
                      size="icon"
                      variant="ghost"
                      aria-label={'Delete ' + schedule.name}
                      onClick={() => void remove(schedule)}
                      disabled={busyId !== null}
                    >
                      {busyId === schedule.id + ':delete'
                        ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
                        : <Trash2 className="h-3.5 w-3.5" aria-hidden />}
                    </Button>
                  </div>
                ) : null}
              </div>

              {editingId === schedule.id ? (
                <div className="border-t border-zinc-100 bg-zinc-50 p-4 dark:border-zinc-800/60 dark:bg-zinc-900/40">
                  <ScheduleForm
                    initial={scheduleDraft(schedule)}
                    saving={busyId === schedule.id}
                    automationEnabled={automationEnabled}
                    onSave={async (draft) => {
                      try {
                        await save(draft, schedule.id);
                      } catch (err) {
                        setError(err instanceof Error ? err.message : 'Schedule could not be saved.');
                      }
                    }}
                    onCancel={() => setEditingId(null)}
                  />
                </div>
              ) : null}

              {schedule.deliveries.length > 0 ? (
                <div className="border-t border-zinc-100 px-4 py-2.5 dark:border-zinc-800/60">
                  <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-wide text-zinc-400 dark:text-zinc-500">
                    Recent deliveries
                  </p>
                  <ul className="space-y-1">
                    {schedule.deliveries.map((delivery) => (
                      <li
                        key={delivery.id}
                        className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-zinc-500"
                      >
                        <Badge tone={statusTone(delivery.status)}>{delivery.status}</Badge>
                        <span>{deliveryLabel(delivery)}</span>
                        <span>{formatRelative(delivery.startedAt)}</span>
                        <span>{delivery.formats.map((format) => format.toUpperCase()).join(' + ')}</span>
                        {delivery.destinations.email.status !== 'not_requested' ? (
                          <Badge tone={statusTone(delivery.destinations.email.status)}>
                            {'Email ' + delivery.destinations.email.status.replace('_', ' ')}
                          </Badge>
                        ) : null}
                        {delivery.destinations.slack.status !== 'not_requested' ? (
                          <Badge tone={statusTone(delivery.destinations.slack.status)}>
                            {'Slack ' + delivery.destinations.slack.status.replace('_', ' ')}
                          </Badge>
                        ) : null}
                        {delivery.attemptCount > 1 ? (
                          <span>{delivery.attemptCount + ' attempts'}</span>
                        ) : null}
                        {delivery.reportId ? (
                          <Link
                            href={'/reports/' + delivery.reportId}
                            className="inline-flex items-center gap-1 font-medium text-accent-700 hover:underline dark:text-accent-400"
                          >
                            <FileText className="h-3 w-3" aria-hidden />
                            Open report
                          </Link>
                        ) : null}
                        {delivery.error ? (
                          <span className="basis-full text-red-600 dark:text-red-400">
                            {delivery.error}
                          </span>
                        ) : null}
                        {delivery.destinations.email.error
                          && delivery.destinations.email.error !== delivery.error ? (
                            <span className="basis-full text-red-600 dark:text-red-400">
                              Email: {delivery.destinations.email.error}
                            </span>
                          ) : null}
                        {delivery.destinations.slack.error
                          && delivery.destinations.slack.error !== delivery.error ? (
                            <span className="basis-full text-red-600 dark:text-red-400">
                              Slack: {delivery.destinations.slack.error}
                            </span>
                          ) : null}
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

function ScheduleForm({
  initial,
  saving,
  automationEnabled,
  onSave,
  onCancel,
}: {
  initial: ScheduleDraft;
  saving: boolean;
  automationEnabled: boolean;
  onSave: (draft: ScheduleDraft) => Promise<void>;
  onCancel: () => void;
}) {
  const [draft, setDraft] = React.useState<ScheduleDraft>(initial);
  const [formError, setFormError] = React.useState<string | null>(null);
  const id = React.useId();
  const timeZoneOptions = COMMON_TIME_ZONES.some((item) => item.value === draft.timeZone)
    ? COMMON_TIME_ZONES
    : [{ value: draft.timeZone, label: draft.timeZone }, ...COMMON_TIME_ZONES];

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setFormError(null);
    try {
      await onSave(draft);
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'Schedule could not be saved.');
    }
  };

  const setFormat = (format: ReportFormat, checked: boolean) => {
    setDraft((current) => ({
      ...current,
      formats: checked
        ? Array.from(new Set([...current.formats, format]))
        : current.formats.filter((item) => item !== format),
    }));
  };

  return (
    <form onSubmit={submit} className="space-y-4">
      <div className="grid gap-3 lg:grid-cols-2">
        <Field label="Schedule name" htmlFor={id + '-name'}>
          <Input
            id={id + '-name'}
            required
            maxLength={120}
            value={draft.name}
            onChange={(event) => setDraft((current) => ({
              ...current,
              name: event.target.value,
            }))}
            placeholder="Monday leadership report"
          />
        </Field>
        <Field
          label="Email recipients"
          htmlFor={id + '-recipients'}
          hint="Separate addresses with commas or put each one on a new line."
        >
          <Textarea
            id={id + '-recipients'}
            className="min-h-20"
            value={draft.recipients}
            onChange={(event) => setDraft((current) => ({
              ...current,
              recipients: event.target.value,
            }))}
            placeholder={'editor@example.com\nnewsroom@example.com'}
          />
        </Field>
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <Field label="Delivery day">
          <Select
            value={String(draft.dayOfWeek)}
            onChange={(event) => setDraft((current) => ({
              ...current,
              dayOfWeek: Number(event.target.value),
            }))}
            options={WEEKDAYS}
          />
        </Field>
        <Field label="Delivery time">
          <Select
            value={String(draft.hour)}
            onChange={(event) => setDraft((current) => ({
              ...current,
              hour: Number(event.target.value),
            }))}
            options={HOURS}
          />
        </Field>
        <Field label="Time zone">
          <Select
            value={draft.timeZone}
            onChange={(event) => setDraft((current) => ({
              ...current,
              timeZone: event.target.value,
            }))}
            options={timeZoneOptions}
          />
        </Field>
      </div>

      <div className="grid gap-4 rounded-md border border-zinc-200 bg-white p-3 sm:grid-cols-2 dark:border-zinc-800 dark:bg-zinc-900">
        <div>
          <p className="mb-2 text-xs font-medium text-zinc-700 dark:text-zinc-300">
            Attachments
          </p>
          <div className="space-y-2">
            <Checkbox
              checked={draft.formats.includes('pptx')}
              onChange={(checked) => setFormat('pptx', checked)}
              label="PowerPoint presentation"
            />
            <Checkbox
              checked={draft.formats.includes('csv')}
              onChange={(checked) => setFormat('csv', checked)}
              label="CSV data file"
            />
          </div>
        </div>
        <div className="space-y-3">
          <Toggle
            checked={draft.includeSlack}
            onChange={(includeSlack) => setDraft((current) => ({
              ...current,
              includeSlack,
            }))}
            label="Also post to Slack"
            description="Posts report links to the newsroom channel configured for Data Dumpster."
          />
          <Toggle
            checked={draft.enabled}
            disabled={!automationEnabled}
            onChange={(enabled) => setDraft((current) => ({ ...current, enabled }))}
            label="Turn on this schedule"
            description={automationEnabled
              ? 'You can pause it later without deleting the settings.'
              : 'The deployment dispatcher is off, so this schedule will be saved paused.'}
          />
        </div>
      </div>

      {formError ? (
        <p role="alert" className="text-[11px] text-red-600 dark:text-red-400">
          {formError}
        </p>
      ) : null}

      <div className="flex items-center gap-2">
        <Button type="submit" variant="primary" size="sm" disabled={saving}>
          {saving ? <Loader2 className="h-3 w-3 animate-spin" aria-hidden /> : null}
          {saving ? 'Saving' : 'Save schedule'}
        </Button>
        <Button type="button" size="sm" onClick={onCancel} disabled={saving}>
          Cancel
        </Button>
      </div>
    </form>
  );
}
