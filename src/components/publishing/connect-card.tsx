'use client';

import * as React from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { CheckCircle2, Plug } from 'lucide-react';
import { Card, CardBody, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { PlatformIcon } from '@/components/ui/platform-icon';
import { PUBLISH_PLATFORM_LABELS, type PublishPlatform } from '@/lib/publishing/platforms';
import { api, fmtWhen, type Target } from './api';
import { usePublish } from './shell';

interface Status {
  configured: boolean;
  xConfigured: boolean;
  brands: { brand: string; connected: boolean; last_synced_at: string | null }[];
}

/**
 * Onboarding a brand's social accounts in three clicks: Connect, sign in to
 * each network on Ayrshare's page, Done. The accounts appear here with sensible
 * posting hours and are matched to their tracked history automatically.
 */
export function ConnectCard({ targets, onChanged }: { targets: Target[]; onChanged: () => void }) {
  const { canApprove, toast } = usePublish();
  const router = useRouter();
  const params = useSearchParams();
  const [status, setStatus] = React.useState<Status | null>(null);
  const [newBrand, setNewBrand] = React.useState('');
  const [busy, setBusy] = React.useState<string | null>(null);
  const [error, setError] = React.useState<string | null>(null);

  const load = React.useCallback(async () => {
    try { setStatus(await api<Status>('/api/publishing/connect')); } catch (e) { setError((e as Error).message); }
  }, []);
  React.useEffect(() => { void Promise.resolve().then(load); }, [load]);

  const sync = React.useCallback(async (brand: string) => {
    setBusy(brand);
    setError(null);
    try {
      const r = await api<{ added: string[]; updated: string[]; linked: number }>('/api/publishing/connect/sync', { method: 'POST', json: { brand } });
      const names = [...r.added, ...r.updated].map((p) => PUBLISH_PLATFORM_LABELS[p as PublishPlatform] ?? p);
      toast(r.linked ? `${brand}: ${names.join(', ')} connected.` : `${brand}: no accounts were connected on Ayrshare yet.`);
      onChanged();
      void load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  }, [toast, onChanged, load]);

  // Back from Ayrshare's page: pick up what was linked, then clean the URL.
  const returned = params.get('connected');
  const handled = React.useRef<string | null>(null);
  React.useEffect(() => {
    if (!returned || handled.current === returned) return;
    handled.current = returned;
    void sync(returned).then(() => router.replace('/publish/accounts'));
  }, [returned, sync, router]);

  const connect = async (brand: string) => {
    setBusy(brand);
    setError(null);
    try {
      const { url } = await api<{ url: string }>('/api/publishing/connect', { method: 'POST', json: { brand } });
      window.location.assign(url);
    } catch (e) {
      setError((e as Error).message);
      setBusy(null);
    }
  };

  const brands = [...new Set([...targets.map((t) => t.brand), ...(status?.brands.map((b) => b.brand) ?? [])])].sort();

  return (
    <Card>
      <CardHeader>
        <div>
          <CardTitle>Connect social accounts</CardTitle>
          <CardDescription>
            Press Connect for a brand, sign in to each network on the page that opens, then press Done. The accounts show up below, ready to post.
          </CardDescription>
        </div>
      </CardHeader>
      <CardBody className="space-y-3">
        {status && !status.configured ? (
          <p className="rounded-md bg-amber-50 p-3 text-sm text-amber-900 dark:bg-amber-950/40 dark:text-amber-200">
            Connecting needs an Ayrshare Launch or Business plan (Premium has only one profile). Add its API key in Vercel as <code>AYRSHARE_API_KEY</code>, redeploy, and the Connect buttons will work.
          </p>
        ) : null}
        {status?.configured && !status.xConfigured ? (
          <p className="text-xs text-zinc-500">X needs our own X developer keys (<code>AYRSHARE_X_API_KEY</code>, <code>AYRSHARE_X_API_SECRET</code>) before it can be connected.</p>
        ) : null}

        <ul className="divide-y divide-zinc-100 dark:divide-zinc-800">
          {brands.map((brand) => {
            const ts = targets.filter((t) => t.brand === brand);
            const live = ts.filter((t) => t.provider !== 'mock' && t.has_secret);
            const conn = status?.brands.find((b) => b.brand === brand);
            return (
              <li key={brand} className="flex flex-wrap items-center gap-3 py-3">
                <span className="w-36 shrink-0 text-sm font-semibold">{brand}</span>
                <span className="flex flex-1 flex-wrap items-center gap-2 text-xs">
                  {ts.map((t) => (
                    <span key={t.id} title={t.provider === 'mock' ? 'Test only' : 'Connected'}
                      className={t.provider !== 'mock' && t.has_secret ? 'inline-flex items-center gap-1 text-emerald-700 dark:text-emerald-400' : 'inline-flex items-center gap-1 text-zinc-400'}>
                      <PlatformIcon platform={t.platform} />
                      {t.provider !== 'mock' && t.has_secret ? <CheckCircle2 className="h-3 w-3" /> : null}
                    </span>
                  ))}
                  <span className="text-zinc-400">
                    {live.length ? `${live.length} connected` : 'Test only, nothing connected'}
                    {conn?.last_synced_at ? ` · checked ${fmtWhen(conn.last_synced_at)}` : ''}
                  </span>
                </span>
                {canApprove ? (
                  <span className="flex gap-1.5">
                    {conn ? <Button size="sm" variant="ghost" disabled={busy === brand} onClick={() => sync(brand)}>Refresh</Button> : null}
                    <Button size="sm" variant={live.length ? 'secondary' : 'primary'} disabled={!status?.configured || busy === brand} onClick={() => connect(brand)}>
                      <Plug className="h-3.5 w-3.5" /> {busy === brand ? 'Working…' : live.length ? 'Add or reconnect' : 'Connect'}
                    </Button>
                  </span>
                ) : null}
              </li>
            );
          })}
        </ul>

        {canApprove ? (
          <div className="flex flex-wrap items-center gap-2 border-t border-zinc-100 pt-3 dark:border-zinc-800">
            <Input className="h-8 w-56" placeholder="Another brand, e.g. STAT" value={newBrand} onChange={(e) => setNewBrand(e.target.value)} />
            <Button size="sm" disabled={!newBrand.trim() || !status?.configured} onClick={() => connect(newBrand.trim())}>
              <Plug className="h-3.5 w-3.5" /> Connect
            </Button>
          </div>
        ) : null}
        {error ? <p className="text-sm text-red-600">{error}</p> : null}
      </CardBody>
    </Card>
  );
}
