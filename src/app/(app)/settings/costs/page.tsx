import type { Metadata } from 'next';
import { PageSection } from '@/components/shell/page-section';
import { Panel } from '@/components/common/panel';
import { roleAtLeast } from '@/lib/roles';
import {
  aiCostsByFeature, costTiles, dailyCosts, vendorCostsByResource,
} from '@/lib/costs/queries';
import { resolveContext } from '../../_lib/context';
import { type SearchParamsInput } from '../../_lib/data';

export const metadata: Metadata = { title: 'Costs' };
export const dynamic = 'force-dynamic';

const AI_COLOR = '#B72B35';
const VENDOR_COLOR = '#A1A1AA';

function usd(v: number, cents = true): string {
  return '$' + v.toFixed(cents ? 2 : 0);
}

/** Human names for ai_usage feature keys. */
const FEATURE_NAMES: Record<string, string> = {
  'post-tagging': 'Post tagging (the reader)',
  'story-narrative': 'Story narratives',
  'tag-curation': 'Tag curation (the curator)',
  'weekly-report-narrative': 'Weekly report narrative',
  'search-screenshot-import': 'Search screenshot reading',
  ask: 'Ask',
};

function Tile({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="rounded-lg border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900/40">
      <p className="text-xs font-medium text-zinc-500 dark:text-zinc-400">{label}</p>
      <p className="pb-num mt-2 text-2xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
        {value}
      </p>
      {sub ? <p className="mt-1 text-[11px] leading-relaxed text-zinc-500">{sub}</p> : null}
    </div>
  );
}

export default async function CostsPage({
  searchParams,
}: {
  searchParams: Promise<SearchParamsInput>;
}) {
  const ctx = await resolveContext(await searchParams);
  if (!roleAtLeast(ctx.role, 'admin')) {
    return (
      <Panel title="Costs are admin-only">
        <p className="px-1 py-2 text-sm text-zinc-600 dark:text-zinc-400">
          Spend figures are visible to admins. Ask an admin if you need them.
        </p>
      </Panel>
    );
  }

  const daily = await dailyCosts(30);
  const [tiles, aiFeatures, vendorResources] = [
    costTiles(daily),
    await aiCostsByFeature(30),
    await vendorCostsByResource(30),
  ];
  const chart = [...daily].sort((a, b) => (a.day < b.day ? -1 : 1));
  const maxDay = chart.reduce((m, c) => Math.max(m, c.aiUsd + c.vendorUsd), 0) || 1;
  const ai30 = aiFeatures.reduce((s, f) => s + f.usd, 0);
  const vendor30 = vendorResources.reduce((s, r) => s + r.usd, 0);

  return (
    <div className="space-y-6">
      <PageSection
        title="Costs"
        description="What the tool spends on models and data, per day. Model figures are metered actuals from the provider's charged cost; vendor figures are estimates computed from records delivered, and the vendor's invoice is the authoritative number. Hosting, the X API subscription, and TikTok's vendor plan bill separately and do not appear here."
      >
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Tile label="Today" value={usd(tiles.todayUsd)} sub="Still accruing" />
          <Tile label="Yesterday" value={usd(tiles.yesterdayUsd)} />
          <Tile label="Last 7 days" value={usd(tiles.last7Usd)} />
          <Tile
            label="Month to date"
            value={usd(tiles.monthToDateUsd)}
            sub="Includes backfills and repairs, which are spikes, not drift"
          />
        </div>

        <div className="mt-4">
          <Panel
            title="Cost per day"
            description="Thirty days. Model spend in red, vendor data purchases in gray."
            note={'Last 30 days: ' + usd(ai30) + ' models (actual) + ' + usd(vendor30)
              + ' vendor data (estimated). Spikes are named events: backfills, repairs, and the corpus read.'}
          >
            {chart.length === 0 ? (
              <p className="px-1 py-2 text-xs text-zinc-500">Nothing metered yet.</p>
            ) : (
              <div className="flex h-44 items-end gap-[3px]">
                {chart.map((c) => {
                  const total = c.aiUsd + c.vendorUsd;
                  return (
                    <div
                      key={c.day}
                      className="group relative flex min-w-0 flex-1 flex-col justify-end self-stretch"
                      title={c.day + ': ' + usd(c.aiUsd) + ' models + ' + usd(c.vendorUsd) + ' vendor'}
                    >
                      <div
                        className="w-full rounded-t-sm"
                        style={{
                          height: Math.max(1, (c.aiUsd / maxDay) * 160) + 'px',
                          backgroundColor: AI_COLOR,
                        }}
                      />
                      <div
                        className="w-full"
                        style={{
                          height: Math.max(c.vendorUsd > 0 ? 1 : 0, (c.vendorUsd / maxDay) * 160) + 'px',
                          backgroundColor: VENDOR_COLOR,
                        }}
                      />
                      <p className="mt-1 truncate text-center text-[8px] text-zinc-400">
                        {c.day.slice(5)}
                      </p>
                      <p className="pb-num truncate text-center text-[9px] font-medium tabular-nums text-zinc-500">
                        {total >= 1 ? usd(total, false) : ''}
                      </p>
                    </div>
                  );
                })}
              </div>
            )}
          </Panel>
        </div>

        <div className="mt-4 grid gap-4 lg:grid-cols-2">
          <Panel
            title="Models, last 30 days"
            description="Metered actuals: the provider's charged cost per call, summed."
            bodyClassName="p-0"
          >
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-[10px] uppercase tracking-wider text-zinc-400">
                  <th className="px-4 py-2 font-semibold">Feature</th>
                  <th className="px-4 py-2 text-right font-semibold">Calls</th>
                  <th className="px-4 py-2 text-right font-semibold">USD</th>
                </tr>
              </thead>
              <tbody>
                {aiFeatures.map((f) => (
                  <tr key={f.feature} className="border-t border-zinc-100 dark:border-zinc-800/60">
                    <td className="px-4 py-2 text-zinc-800 dark:text-zinc-200">
                      {FEATURE_NAMES[f.feature] ?? f.feature}
                    </td>
                    <td className="pb-num px-4 py-2 text-right tabular-nums text-zinc-500">
                      {f.calls.toLocaleString()}
                    </td>
                    <td className="pb-num px-4 py-2 text-right font-medium tabular-nums text-zinc-900 dark:text-zinc-100">
                      {usd(f.usd)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Panel>

          <Panel
            title="Vendor data, last 30 days"
            description="Estimates: records delivered times the vendor's published rate."
            note="Records is what the vendor bills for; stored is what we kept. A widening gap between them is waste. Brand-collection datasets appear here from Aug 26 on, when metering reached the vendor client."
            bodyClassName="p-0"
          >
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-[10px] uppercase tracking-wider text-zinc-400">
                  <th className="px-4 py-2 font-semibold">Dataset</th>
                  <th className="px-4 py-2 text-right font-semibold">Records</th>
                  <th className="px-4 py-2 text-right font-semibold">Stored</th>
                  <th className="px-4 py-2 text-right font-semibold">Est. USD</th>
                </tr>
              </thead>
              <tbody>
                {vendorResources.length === 0 ? (
                  <tr>
                    <td colSpan={4} className="px-4 py-4 text-center text-xs text-zinc-500">
                      No vendor purchases metered in this window.
                    </td>
                  </tr>
                ) : (
                  vendorResources.map((r) => (
                    <tr key={r.resource} className="border-t border-zinc-100 dark:border-zinc-800/60">
                      <td className="px-4 py-2 text-zinc-800 dark:text-zinc-200">{r.name}</td>
                      <td className="pb-num px-4 py-2 text-right tabular-nums text-zinc-500">
                        {r.records.toLocaleString()}
                      </td>
                      <td className="pb-num px-4 py-2 text-right tabular-nums text-zinc-500">
                        {r.stored > 0 ? r.stored.toLocaleString() : '—'}
                      </td>
                      <td className="pb-num px-4 py-2 text-right font-medium tabular-nums text-zinc-900 dark:text-zinc-100">
                        {usd(r.usd)}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </Panel>
        </div>
      </PageSection>
    </div>
  );
}
