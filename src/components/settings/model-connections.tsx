'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { Cpu, Loader2, Plus, Trash2, Zap } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Card, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge, Dot } from '@/components/ui/badge';
import { EmptyState } from '@/components/ui/empty-state';
import { Tooltip } from '@/components/ui/tooltip';
import { formatRelative, formatUsd } from '@/components/ui/format';
import { ModelConnectionForm } from './model-connection-form';
import type { ProviderInfo } from './provider-info';

export interface ConnectionRecord {
  id: string;
  label: string;
  provider: string;
  providerLabel: string;
  model: string;
  baseUrl: string | null;
  maskedKey: string | null;
  inputCostPerMtok: number | null;
  outputCostPerMtok: number | null;
  maxOutputTokens: number;
  isDefault: boolean;
  enabled: boolean;
  lastCheckedAt: string | null;
  lastCheckOk: boolean | null;
  lastCheckError: string | null;
}

type Health = 'ok' | 'failing' | 'unknown';

function healthOf(c: ConnectionRecord): Health {
  if (c.lastCheckOk === null) return 'unknown';
  return c.lastCheckOk ? 'ok' : 'failing';
}

const HEALTH_COLOR: Record<Health, string> = {
  ok: '#10b981',
  failing: '#ef4444',
  unknown: '#a1a1aa',
};

const HEALTH_COPY: Record<Health, string> = {
  ok: 'Last check succeeded.',
  failing: 'Last check failed. Briefs and Ask will not run through this connection until it passes.',
  unknown: 'Never tested. Run a check before relying on it.',
};

export function ModelConnections({
  connections,
  providers,
}: {
  connections: ConnectionRecord[];
  providers: ProviderInfo[];
}) {
  const router = useRouter();
  const [adding, setAdding] = React.useState(connections.length === 0);
  const [busyId, setBusyId] = React.useState<string | null>(null);
  const [testResult, setTestResult] = React.useState<Record<string, string>>({});
  const [error, setError] = React.useState<string | null>(null);

  const test = async (id: string) => {
    setBusyId(id);
    setError(null);
    try {
      const res = await fetch('/api/settings/models/' + id + '/test', { method: 'POST' });
      const body = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string; latencyMs?: number };
      setTestResult((prev) => ({
        ...prev,
        [id]: res.ok && body.ok
          ? 'Reachable' + (body.latencyMs ? ' in ' + body.latencyMs + 'ms' : '') + '.'
          : (body.error ?? 'The endpoint did not answer.'),
      }));
      router.refresh();
    } catch (err) {
      setTestResult((prev) => ({
        ...prev,
        [id]: err instanceof Error ? err.message : 'The test request failed.',
      }));
    } finally {
      setBusyId(null);
    }
  };

  const mutate = async (id: string, method: 'PATCH' | 'DELETE', body?: unknown) => {
    setBusyId(id);
    setError(null);
    try {
      const res = await fetch('/api/settings/models/' + id, {
        method,
        headers: body ? { 'content-type': 'application/json' } : undefined,
        body: body ? JSON.stringify(body) : undefined,
      });
      if (!res.ok) throw new Error('Request failed with status ' + res.status + '.');
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not update the connection.');
    } finally {
      setBusyId(null);
    }
  };

  return (
    <Card>
      <CardHeader>
        <div>
          <CardTitle>Connections</CardTitle>
          <p className="mt-0.5 text-xs text-zinc-500 dark:text-zinc-400">
            Every AI feature in Data Dumpster runs through one of these. There is no fallback to a model
            you did not configure.
          </p>
        </div>
        <Button size="sm" variant="primary" onClick={() => setAdding((v) => !v)}>
          <Plus className="h-3 w-3" aria-hidden />
          Add connection
        </Button>
      </CardHeader>

      {error ? (
        <p className="border-b border-red-200 bg-red-50 px-4 py-2 text-xs text-red-700 dark:border-red-900/50 dark:bg-red-950/30 dark:text-red-400">
          {error}
        </p>
      ) : null}

      {adding ? (
        <div className="border-b border-zinc-200 bg-zinc-50 p-4 dark:border-zinc-800 dark:bg-zinc-900/40">
          <ModelConnectionForm
            providers={providers}
            onDone={() => setAdding(false)}
            onCancel={() => setAdding(false)}
          />
        </div>
      ) : null}

      {connections.length === 0 && !adding ? (
        <EmptyState
          compact
          icon={Cpu}
          title="No model connected"
          description="Briefs, Ask and AI tagging are switched off until Data Dumpster has an endpoint to call. Point it at whatever inference you already pay for."
        />
      ) : (
        <ul className="divide-y divide-zinc-100 dark:divide-zinc-800/60">
          {connections.map((c) => {
            const health = healthOf(c);
            return (
              <li key={c.id} className="px-4 py-3">
                <div className="flex items-start gap-3">
                  <Tooltip
                    side="top"
                    content={
                      <span className="block">
                        <span className="block font-medium text-zinc-900 dark:text-zinc-100">
                          {HEALTH_COPY[health]}
                        </span>
                        {c.lastCheckedAt ? (
                          <span className="block text-zinc-500">
                            {'Checked ' + formatRelative(c.lastCheckedAt)}
                          </span>
                        ) : null}
                        {c.lastCheckError ? (
                          <span className="block text-red-600 dark:text-red-400">{c.lastCheckError}</span>
                        ) : null}
                      </span>
                    }
                  >
                    <span tabIndex={0} className="mt-1.5 inline-flex">
                      <Dot color={HEALTH_COLOR[health]} pulse={health === 'ok'} />
                    </span>
                  </Tooltip>

                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-xs font-medium text-zinc-900 dark:text-zinc-100">{c.label}</span>
                      <Badge tone="neutral">{c.providerLabel}</Badge>
                      {c.isDefault ? <Badge tone="accent">Default</Badge> : null}
                      {c.enabled ? null : <Badge tone="outline">Disabled</Badge>}
                    </div>
                    <p className="pb-num mt-0.5 truncate text-[11px] text-zinc-500">
                      {c.model + (c.baseUrl ? ' · ' + c.baseUrl : '')}
                    </p>
                    <p className="pb-num mt-0.5 text-[11px] text-zinc-400">
                      {(c.maskedKey ? 'key ' + c.maskedKey : 'no key required') +
                        ' · ' +
                        (c.inputCostPerMtok !== null
                          ? formatUsd(c.inputCostPerMtok) + ' in / ' + formatUsd(c.outputCostPerMtok) + ' out per Mtok'
                          : 'no cost recorded')}
                    </p>
                    {testResult[c.id] ? (
                      <p
                        className={cn(
                          'mt-1 text-[11px]',
                          testResult[c.id].startsWith('Reachable')
                            ? 'text-emerald-700 dark:text-emerald-400'
                            : 'text-red-600 dark:text-red-400',
                        )}
                      >
                        {testResult[c.id]}
                      </p>
                    ) : null}
                  </div>

                  <div className="flex shrink-0 items-center gap-1">
                    <Button size="sm" disabled={busyId === c.id} onClick={() => test(c.id)}>
                      {busyId === c.id ? (
                        <Loader2 className="h-3 w-3 animate-spin" aria-hidden />
                      ) : (
                        <Zap className="h-3 w-3" aria-hidden />
                      )}
                      Test
                    </Button>
                    {c.isDefault ? null : (
                      <Button
                        size="sm"
                        disabled={busyId === c.id}
                        onClick={() => mutate(c.id, 'PATCH', { isDefault: true })}
                      >
                        Make default
                      </Button>
                    )}
                    <Button
                      size="icon"
                      variant="ghost"
                      aria-label={'Delete ' + c.label}
                      disabled={busyId === c.id}
                      onClick={() => mutate(c.id, 'DELETE')}
                    >
                      <Trash2 className="h-3.5 w-3.5" aria-hidden />
                    </Button>
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </Card>
  );
}
