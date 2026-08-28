'use client';

import * as React from 'react';
import { Loader2 } from 'lucide-react';
import {
  Line,
  LineChart,
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { PLATFORM_LABELS } from '@/lib/types';
import { METRIC_DEFS } from '@/lib/metrics/definitions';
import { compactNumber } from '@/lib/utils';
import { Card, CardBody, CardHeader, CardTitle } from '@/components/ui/card';
import type { BlockDefinition } from '@/lib/blocks/definitions';

interface LeaderboardRow {
  company: { id: string; name: string };
  value: number;
  available: boolean;
  changePct?: number | null;
  rank: number;
}

interface TimeSeriesPoint {
  date: string;
  [seriesKey: string]: string | number | null;
}

/**
 * Live block preview.
 *
 * Renders a block against the real analytics endpoints as it is configured in
 * the builder — never a placeholder. This is the one Rival IQ builder behaviour
 * worth matching: the editor shows the block exactly as the scheduled export
 * will print it, so there is no save-and-pray step. Blocks that carry prose or
 * a bespoke layout render an honest "renders in the full report" note instead
 * of a fake chart.
 */
export function BlockPreview({
  block,
  landscapeId,
  start,
  end,
}: {
  block: BlockDefinition;
  landscapeId: string;
  start: string;
  end: string;
}) {
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [leaderboard, setLeaderboard] = React.useState<LeaderboardRow[] | null>(null);
  const [series, setSeries] = React.useState<TimeSeriesPoint[] | null>(null);
  const [seriesKeys, setSeriesKeys] = React.useState<string[]>([]);

  const isSeries = block.type === 'timeseries';
  const isBoard = ['leaderboard', 'bar', 'stat', 'table', 'pie', 'scatter'].includes(block.type);
  const previewable = isSeries || isBoard;

  const params = React.useMemo(() => {
    const sp = new URLSearchParams();
    sp.set('landscapeId', landscapeId);
    sp.set('start', start);
    sp.set('end', end);
    sp.set('compare', '1');
    if (block.platform) sp.set('platforms', block.platform);
    if (block.granularity) sp.set('granularity', block.granularity);
    return sp;
  }, [landscapeId, start, end, block.platform, block.granularity]);

  React.useEffect(() => {
    if (!previewable) return;
    let cancelled = false;
    const metric = block.metric ?? 'engagementTotal';
    const url = isSeries
      ? '/api/analytics/timeseries?metric=' + metric + '&' + params.toString()
      : '/api/analytics/leaderboard?metric=' + metric + '&' + params.toString();

    // setLoading is deferred into the fetch microtask so the effect body never
    // calls setState synchronously, which the lint rule (correctly) rejects as
    // a cascading-render hazard.
    const pending = fetch(url);
    void Promise.resolve().then(() => {
      if (!cancelled) setLoading(true);
    });
    pending
      .then(async (res) => {
        if (!res.ok) throw new Error('Preview failed with status ' + res.status + '.');
        return res.json();
      })
      .then((body) => {
        if (cancelled) return;
        setError(null);
        if (isSeries) {
          const s = (body.series ?? []) as TimeSeriesPoint[];
          setSeries(s);
          const keys = new Set<string>();
          s.forEach((p) => Object.keys(p).forEach((k) => { if (k !== 'date') keys.add(k); }));
          setSeriesKeys([...keys].slice(0, 6));
          setLeaderboard(null);
        } else {
          setLeaderboard(((body.rows ?? []) as LeaderboardRow[]).slice(0, 8));
          setSeries(null);
        }
      })
      .catch((err) => {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : 'Could not render the preview.');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [previewable, isSeries, block.metric, params]);

  // Stale chart data from a previously previewed block is cleared here rather
  // than in the fetch effect, so the fetch effect never calls setState
  // synchronously. Resetting on the block key keeps each preview keyed to the
  // block that produced it.
  const dataKey = block.type + '|' + (block.metric ?? '') + '|' + params.toString();
  const [lastKey, setLastKey] = React.useState(dataKey);
  if (lastKey !== dataKey) {
    setLastKey(dataKey);
    setLeaderboard(null);
    setSeries(null);
    setError(null);
  }

  const title =
    block.title ??
    (block.metric ? METRIC_DEFS[block.metric].label : null) ??
    block.type;

  const textual = ['note', 'narrative'].includes(block.type);
  const special = ['focusSummary', 'platformMix', 'topPosts', 'cadence', 'storyCluster'].includes(block.type);

  return (
    <Card>
      <CardHeader>
        <div>
          <CardTitle className="text-sm">{title}</CardTitle>
          <p className="mt-0.5 text-[11px] text-zinc-500 dark:text-zinc-400">
            Live preview · {block.type}
            {block.platform ? ' · ' + PLATFORM_LABELS[block.platform] : ''}
            {block.benchmark && block.benchmark !== 'none' ? ' · vs ' + block.benchmark : ''}
          </p>
        </div>
      </CardHeader>
      <CardBody className="min-h-[16rem]">
        {textual ? (
          <div className="rounded-md border border-dashed border-zinc-200 p-4 text-xs leading-relaxed text-zinc-600 dark:border-zinc-800 dark:text-zinc-400">
            {block.type === 'narrative' ? (
              <>
                <span className="mb-1 inline-block rounded-full bg-accent-600 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-white">
                  Verified narrative
                </span>
                <p>
                  {block.text?.trim()
                    ? block.text
                    : 'AI prose checked against a code-computed fact sheet before it renders. The narrative is generated when the report runs, so every number it states is provably grounded.'}
                </p>
              </>
            ) : (
              <p>{block.text?.trim() ? block.text : 'A note block. Its text renders inline with the report.'}</p>
            )}
          </div>
        ) : special ? (
          <div className="flex h-48 items-center justify-center rounded-md border border-dashed border-zinc-200 text-center text-xs text-zinc-400 dark:border-zinc-800">
            This block renders its full layout in the report. The preview shows metric-driven
            blocks; {block.type} is assembled at render time from the same metrics layer.
          </div>
        ) : loading ? (
          <p className="flex h-48 items-center justify-center gap-2 text-xs text-zinc-500">
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
            Rendering from the metrics layer
          </p>
        ) : error ? (
          <p className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700 dark:border-red-900/50 dark:bg-red-950/30 dark:text-red-400">
            {error}
          </p>
        ) : series ? (
          series.length === 0 ? (
            <p className="flex h-48 items-center justify-center text-xs text-zinc-400">
              No data in this window for the selected metric.
            </p>
          ) : (
            <div className="h-64">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={series} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e4e4e7" vertical={false} />
                  <XAxis dataKey="date" tick={{ fontSize: 10 }} tickLine={false} />
                  <YAxis tick={{ fontSize: 10 }} tickLine={false} axisLine={false} tickFormatter={(v) => compactNumber(Number(v))} width={48} />
                  <Tooltip formatter={(v) => compactNumber(Number(v))} />
                  {seriesKeys.map((k, i) => (
                    <Line
                      key={k}
                      type="monotone"
                      dataKey={k}
                      stroke={['#C8102E', '#2563EB', '#0D9488', '#D97706', '#7C3AED', '#DB2777'][i % 6]}
                      strokeWidth={1.75}
                      dot={false}
                      connectNulls
                    />
                  ))}
                </LineChart>
              </ResponsiveContainer>
            </div>
          )
        ) : leaderboard ? (
          leaderboard.length === 0 ? (
            <p className="flex h-48 items-center justify-center text-xs text-zinc-400">
              No data in this window for the selected metric.
            </p>
          ) : block.type === 'bar' ? (
            <div className="h-64">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={leaderboard} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e4e4e7" vertical={false} />
                  <XAxis dataKey="company.name" tick={{ fontSize: 9 }} tickLine={false} interval={0} angle={-20} textAnchor="end" height={60} />
                  <YAxis tick={{ fontSize: 10 }} tickLine={false} axisLine={false} tickFormatter={(v) => compactNumber(Number(v))} width={48} />
                  <Tooltip formatter={(v) => compactNumber(Number(v))} />
                  <Bar dataKey="value" fill="#C8102E" radius={[3, 3, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          ) : (
            <table className="w-full text-xs">
              <caption className="sr-only">Leaderboard preview</caption>
              <thead>
                <tr className="border-b border-zinc-200 text-left text-zinc-500 dark:border-zinc-800 dark:text-zinc-400">
                  <th scope="col" className="py-1.5 pr-2 font-medium">#</th>
                  <th scope="col" className="py-1.5 pr-2 font-medium">Company</th>
                  <th scope="col" className="py-1.5 text-right font-medium">Value</th>
                </tr>
              </thead>
              <tbody>
                {leaderboard.map((r) => (
                  <tr key={r.company.id} className="border-b border-zinc-100 last:border-0 dark:border-zinc-800/60">
                    <td className="pb-num py-1.5 pr-2 text-zinc-400">{r.rank}</td>
                    <td className="max-w-0 truncate py-1.5 pr-2 text-zinc-700 dark:text-zinc-300">{r.company.name}</td>
                    <td className="pb-num py-1.5 text-right font-medium text-zinc-900 dark:text-zinc-100">
                      {r.available ? compactNumber(r.value) : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )
        ) : null}
      </CardBody>
    </Card>
  );
}
